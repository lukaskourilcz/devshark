# Deep End design system

This is the reference for building a devShark screen. The tokens live in `client/src/styles/astryx-theme.css` and the shared floors in `client/src/styles/app-shell.css`, layered over Astryx. `DESIGN_RULES.md` holds the enforceable rules and names the check behind each one. Epic U (#572, the UX audit of 23 October 2026 in `docs/design/ux-audit.md`) set the current system: one button scale, one page width per route, and shared question, coding, header and state components.

A new screen takes its width from the route shell, its controls from the 44px scale, its one primary from `SwimCta` md, and its parts from the catalogue below. The short checklist is in `.claude/skills/deep-end-design-system/SKILL.md`.

## Tokens

### Page widths

Set in `astryx-theme.css` (UX audit U1, #573). A page never writes its own page `max-width`.

| Token | Width | Use |
|---|---|---|
| `--ss-width-task` | 640px | Auth, billing, checkout, StatePanel, lobby and gates. Never a route width. |
| `--ss-width-question` | 880px | Active question/answer blocks and Daily. |
| `--ss-width-narrow` | 800px | The route default. |
| `--ss-width-standard` | 1000px | Public home. |
| `--ss-width-wide` | 1200px | Operational learning, account and collection screens. |
| `--ss-width-chrome` | 1168px | The floating header and the footer, on every route, so neither moves when the route width changes. |

A component may cap its own text measure (`max-width: 68ch` on a paragraph). Question columns use `--ss-width-question`; auth and gate columns use `--ss-width-task`.

### Control heights

| Size | Token | Height | Use |
|---|---|---|---|
| Default | `--ss-control-height` | 44px | Every page action and form control on every pointer: `.astryx-button`, `.astryx-segmented-control-item`, `.astryx-text-input` and its input. |
| Compact | `--ss-control-height-compact` | 36px | Only controls inside an element with class `ss-compact` (a component's own toolbar), on a fine pointer, each with a 44px hit area drawn by `::before`. On a coarse pointer they stay 44px. |

The floor in `app-shell.css` is a `min-height`/`min-width` with `!important`, because Astryx's StyleX rules cannot be reached by a class selector otherwise. It is the only place that does this.

### Spacing

| Token | Value | Use |
|---|---|---|
| `--ss-page-gutter` | 26px / 64px above 700px | Shared page side gutter; content width is still capped centrally. |
| `--ss-space-gutter` | 16px to 32px (`clamp`) | Internal/public layout spacing where already used. |
| `--ss-space-section` | 32px to 64px (`clamp`) | Space between page sections. |

Inside a component the steps are 8px (a header's title and lead, answer rows), 16px (a panel to its action row, rows in a settings list) and 24px (panel padding, a page header to its first panel). The question panel's padding drops to 16px under 560px.

### Type sizes

| Token | Value | Use |
|---|---|---|
| `--ss-type-display` | clamp, about 2.8rem to 4.2rem | The public hero only. |
| `--ss-type-title` | clamp, about 2rem to 3.5rem | Large public titles. |
| `--ss-type-body` | 1rem to 1.125rem | Reading text. |
| `--ss-type-large` | 1.125rem | A large lead. |
| `--ss-type-compact` | .875rem | Compact body and controls. |
| `--ss-type-meta` | .8rem | Meta lines, eyebrows. |
| `--ss-type-label` | .72rem | Labels. |

Fixed sizes on top of these: the operational `h1` is Astryx `display-3`; a public section `h2` is `.ss-section-title` (800 weight, 1.75rem, 1.5rem under 600px, -0.015em tracking, in `components/landing/landingSections.css`); a question run's `h1` is `--ss-question-title-size` (1.25rem/700); a coding task's `h1` is 1.35rem/700. A page action's text is 16px/600.

### Radii

`--radius-page` (2rem) for page features, `--radius-container` (1.5rem) for panels and cards, `--radius-element` (.85rem) for controls, inputs and selects, `--radius-inner` (.65rem) for inner tiles and chips. The pill shape (`999px`) is for buttons (`.astryx-button`, `.ss-fin-button`), header nav links (`.ss-navlink`), tags (`.ss-tag`), compact filters such as the topic pills (`.ss-topic-pill`), small inline toggles (glossary terms, figure buttons) and compact segmented controls. Cards, panels, inputs, selects, radio cards, drawer links and dialogs use the radius tokens.

### Motion

`--ss-motion-feedback` (160ms; 100ms under the Apple layer), `--ss-motion-reveal` (350ms), `--ss-motion-ambient` (2400ms) and the two `--ss-motion-swim-*` tokens. Route fade about 140ms with no blank exit; selection and button response 120 to 180ms; fin reveals by opacity only. Every non-essential motion stops under `prefers-reduced-motion: reduce`, and dense admin screens carry no decorative animation.

## Page widths

The route shell in `client/src/App.tsx` reads the one map, `pageMaxWidth` in `client/src/components/ui/pageWidth.ts`, writes the result to `--ss-page-width`, and the keyed route box (`.ss-route`) takes it as its `max-width`.

| Route | Width |
|---|---|
| `/` | `--ss-width-standard` (1000px) |
| Coding, Learn, Quiz, Challenge, Today, Profile, Play, Typing, Cards, Collection, Shop, Leaderboard, Career | `--ss-width-wide` (1200px) |
| `/dev` | uncapped |
| Every other route | `--ss-width-narrow` (800px) |

A part that needs the wide page while it is mounted (a Learn level's or a path's coding phase) puts the class `ss-wide-page` on its root: `.ss-route:has(.ss-wide-page)` widens the route box to `--ss-width-wide` for as long as the part is there, with no state and no extra render. To give a new route a width, add it to the map and to `client/tests/page-width.test.tsx`.

The shared page roots (`.de-page`, `.cd-page`, `.lb`, `.ss-info-page`) and a page's own top stack fill the column, so the header, the controls and the content share one left edge (`client/tests/page-own-width.test.ts`). The `Page` layout always draws its kicker line (empty and `aria-hidden` when a page passes no kicker), so every `Page` h1 sits at one x and one y.

## Buttons

**The scale.** 44px for everything; 36px only inside `.ss-compact` with a 44px hit area. Never size a button page by page and never pass `size="sm"` to an Astryx `Button` or `IconButton` on a page: the floor lifts it anyway and `check:design` fails it. An in-row utility (a Retry inside a banner, a Remove on a list row) is the one small button, and each is listed in `scripts/design-contract-allowlist.json` with its reason.

**Page actions.** 44px, 20px inline padding, 16px/600 text, pill. `.ss-action` applies that type through Astryx's own variables (`--spacing-3`, `--text-label-size`, `--font-weight-medium`). Every button in `.ss-info-actions`, `.ss-auth__actions` and `.ss-state-panel__actions` gets it without a class; elsewhere pass `className="ss-action"`.

**One primary per screen.** `SwimCta` md (44px, `components/landing/LandingKit.tsx`) is the single filled primary on a screen; every other action is an Astryx `secondary` or `ghost` at 44px. The primary is never the smallest control in its row. A second task's button turns primary only once its own input is complete (on `/play`, Create is the `SwimCta` and Join stays secondary until the field holds a whole six-character code). A row of buttons that switches the view is not an action and is never filled: the open view is secondary with `aria-current="page"`, the rest ghost (the `/collection` shelf tabs). `FadeFinCta` is the quieter fin for a list row's action (Start, Continue or Review by progress). Keyboard focus gets the same fin as hover; disabled buttons get none.

**Card actions.** Every action in a card is the default size, so a card's primary is never smaller than its secondaries.

**Icon buttons.** 44×44 with a 20px glyph, an `aria-label` and a tooltip. A dialog's close button is the Astryx one, which the floor makes 44px (its glyph stays 16px). Icons in one row share one drawing: the header's Leaderboard, Premium and Coins are stroke icons in the text colour (`TrophyIcon`, the Premium diamond, `CoinsIcon` from `components/ui/icons.tsx`); the filled `CoinIcon` stays for the Coins page balance.

**Hit areas.** A control the app draws itself that keeps a smaller look still takes a 44px press: a transparent, `aria-hidden` layer inside it, positioned absolutely and reaching past its edges by `calc((100% - var(--ss-control-height)) / 2)`. The roadmap's 31px part cells do this (`.rm-part-pill__hit` in `RoadmapTree.tsx`). A control whose size is its look is drawn at 44px or more (the Learn map's levels are 44px, 50px when current). The footer's appearance and sound toggles are compact pills with the same hit area; each label says what pressing it does ('Dark mode', 'Turn sound on') and is its whole accessible name. The glossary term chips (`.ss-term__button`) are 44px pills, 36px with the hit area inside `.ss-compact`.

**Form controls.** A control group (`ToggleButtonGroup`, `SegmentedControl`, a `select`) takes its label above it, never as a suffix, at the default size, so one form has one control height. Two short groups may sit side by side from 900px. A control with more options than one phone row holds becomes one control: on `/play` the time limit is one 44px `.ss-select`, and the topic pills fold below 600px behind a 44px `<details>` whose summary names the choice ('Topics: all').

## Shared components

Search here before you build anything. Each entry is the one component for its job.

| Component | File | Use it for |
|---|---|---|
| `PageHeader` | `client/src/components/ui/PageHeader.tsx` | The title of an operational page. |
| `Page` | `client/src/components/PublicInfoPages.tsx` | The editorial header and body of a public page (legal, auth, `/premium` steps, `/classroom`, 404). |
| `LearnPageHeader` | `client/src/components/learn/LearnPageHeader.tsx` | A Learn-area page that is not a section: `/roadmap`, `/big-o`, `/learn/big-o`. |
| `StatePanel` | `client/src/components/ui/StatePanel.tsx` | Any state with nothing else to show, and every signed-out block (`inline`). |
| `QuestionShell`, `QuestionHeader`, `AnswerOptionList`, `QuestionHint`, `QuestionFeedback`, `QuestionActions` | `client/src/components/question/` (import from `index.ts`) | Every question screen. |
| `CodingWorkbench`, `BriefZone` | `client/src/coding/CodingWorkbench.tsx`, `client/src/coding/BriefZone.tsx` | Every place a coding task opens. |
| `SwimCta`, `FadeFinCta`, `Kicker`, `WaterlineRule` | `client/src/components/landing/LandingKit.tsx` | The one primary, a quiet row action, a kicker with its wave, a rule. |
| `.ss-panel`, `.ss-raised`, `.ss-lift` | `astryx-theme.css` | A panel, a read-only raised card, a clickable card that lifts. |
| `.de-setting-row` | `client/src/components/DeepEndScreens.css` | One account action per row. |
| `RadioCardGroup`, `RadioCard` | `client/src/components/ui/RadioCards.tsx` | A single choice from cards. `CheckCard` for several. |
| `BrandedConfirmDialog` | `client/src/components/ui/BrandedConfirmDialog.tsx` | A destructive confirmation. |
| `LoadingScreen`, `QuoteLoader`, `ErrorRetry` | `client/src/components/LoadingScreen.tsx`, `client/src/components/ErrorRetry.tsx` | Page loading and a failed part. |
| `SharkFin`, `BrandLogo`, `CategoryGlyph` | `SharkFin.tsx`, `BrandLogo.tsx`, `ui/techIcons.tsx` | The fin, the wordmark, topic logos. Never redraw the fin. |

### Page headers

**`PageHeader`** is the only operational header: an optional `<Kicker>`, the route's one `h1` in ink at `--ss-type-page-title` (29px), one lead line (at most 68ch), 8px apart, on the column's left edge. `titleRef` makes the `h1` a focus target (`tabIndex` -1, a ring only for keyboard focus). `aside` puts a short status at the end of the `h1`'s row; pass it (null while empty) for as long as the header shows, so the `h1` does not remount when the status arrives. Children sit under the lead as a status line. Users: `/collection`, `/cards`, `/leaderboard`, `/play`, the Quiz and Challenge setups and `/today`. Leave the kicker out when tabs or the title already say it. The lead is the scope sentence, and the one control row sits right on the list it filters (the Leaderboard: period control left, topic filter right, then the board).

**`Page`** keeps the editorial header for public pages. `/daily` keeps its markup through `DailyHeader` (`DailyStaticArticle.tsx`), which the build also writes into the static HTML; its kicker is the day.

**Area titles.** Learn and the Coding track pages retain `<Kicker as="h1" className="ss-section-title">` (accent, 800 weight, the wave under it). The Coding home uses the neutral operational `PageHeader`. `LearnPageHeader` keeps Learn's title on the `PageHeader` frame with one supporting line and at most one small `context` link above it (its press reaches 44px through padding pulled back by a negative margin). A link in the Learn area is `.learn-link`: `--color-text-accent` with a 1px underline, never the browser's blue. A heading that links stays in the text colour with an accent arrow (`::after`, `content: '→' / ''`).

### StatePanel and signed-out blocks

`StatePanel` is one component with two looks.

- **Panel** (default): the state is the whole screen, or the whole section under a page header. Centred in `--ss-width-task`, an optional icon and `<Kicker>`, one heading (`level` 1 when it is the page, 2 under a page header), one body line (`live` makes it a polite status) and its actions, the primary first, all 44px. A panel that is the route’s only content also centres vertically in the available space. Users: the Shark Cards states on `/cards` and `/collection`, the sign-in gates on `/play` and `/play/:code`, Play's "Live games are switched off", and every phase of `/settings/github`.
- **`inline`**: one part of a screen that otherwise draws waits for sign-in. One sentence in secondary text and its action, with no heading, card, border, background or padding. Users: `/shop` and its invite section, `/premium/checkout`.

`signIn` draws the one "Sign in" first in the row (44px, `aria-haspopup="dialog"`, opens the sign-in dialog). Pass `signIn={{ returnTo }}` when the next step lives elsewhere, `label` when the step needs its own verb ("Sign in to continue"), and `emphasis: 'secondary'` on a second block, so the screen keeps one filled primary. No screen builds its own sign-in button or gate card. A block stands in place of what a visitor cannot see yet: no placeholder number ("—") for a balance. A button the visitor cannot use yet says so ("Sign in to buy") and opens sign-in instead of sitting disabled.

### Question screens

Every question screen draws through `client/src/components/question/` (UX audit U2, #574). Sizes are tokens in `question.css`; words are `question.*` keys in `client/src/i18n/translations.question.ts`, which only the question chunks load (`client/tests/question-copy.test.ts`).

| Token | Value | Use |
|---|---|---|
| `--ss-question-block-min` | 200px | The question block's reserved height, so the answers start at one y. |
| `--ss-question-block-max` | 40vh | Past this the block scrolls inside itself. |
| `--ss-answer-row-min` | 48px | One answer row. |
| `--ss-answer-gap` | 8px | Between answer rows. |
| `--ss-answer-chip` | 26px | The number chip. |
| `--ss-question-title-size` | 1.25rem | The run's `h1`. |
| `--ss-question-tags-min` | 56px | Under 560px, the header's tag row: two lines, so a wrapping topic name does not move the answers. |

A run, top to bottom: `QuestionShell` › `QuestionHeader` › question block › `AnswerOptionList` › `QuestionHint` › `QuestionFeedback` (once graded), then `QuestionActions`. Active Quiz, Learn and skill check use the compact shell. It keeps 44px targets and places the action row inside the card. Learn level questions use larger text, code and answer labels within that layout. Long content scrolls inside the card, independently of its header and footer.

- **`QuestionShell`**: the `--ss-width-question` column with one `.ss-panel` (24px padding, 16px under 560px, no accent edge) and the actions 16px under it. Props: `header`, `question`, `questionId`, `children`, `actions`, `notice`, `stable` (default `true`; `false` for one question on its own page), `focusable`, `className`, `labelledBy`. The ref is the question block. A runner sets no width, card or `flex: 1` of its own. Active questions use a stable viewport anchor based on a 640px work area, so a late notice after the actions grows downward without moving the answers.
- **`QuestionHeader`**: row 1 the run's `h1` ("Quiz · Question 3 of 10", `run` muted before `title`) and `WaterlineProgress`, run status on the right; row 2 tags, the difficulty badge and the tools. Tools are `QuestionIconButton`s: 44×44, 20px stroke glyph (`HintIcon`, `ReportFlagIcon`, `ExitIcon`), `aria-label` and tooltip. Every runner can report; Exit asks first in an `AlertDialog`.
- **`AnswerOptionList`**: a vertical `RadioCardGroup` of 48px rows 8px apart with a 26px chip; the selection is `--brand-accent`, never a track colour. Props: `options`, `value`, `onChange`, `onActivate` (a press commits at once), `labelledBy`, `disabled`, `grade` (`{ correct, picked }`), `renderOption`, `className`. Graded rows show ✓ or ✕ in a 20px slot every row keeps, with "Correct answer" and "Your pick" in the accessible name, and a hidden semibold copy of each row's words reserves its height, so grading never rewraps or moves a row. Number keys belong to the runner.
- **`QuestionHint`**: "Press 1–{max} to {select|answer} · Enter to {continue|submit}" under the answers, only with a fine pointer from 600px. `hidden` hides the words and keeps the line.
- **`QuestionFeedback`**: the verdict as an Astryx `Banner` in normal flow under the list and hint, inside the panel. It takes focus (`autoFocus`, default `true`); pass `false` when `QuestionActions focusPrimary` moves focus to Continue. Nothing sits over the answers.
- **`QuestionActions`**: one 44px row; secondaries left, the one `SwimCta` md `primary` (`{ label, onClick, disabled, unavailable, describedBy }`) right. Under 560px the primary is the last row at full width and the secondaries share the row above. `focusPrimary` scrolls the least that shows the button and never past the top of the answers. `unavailable` keeps it focusable with `aria-disabled` and a reason.

How each runner uses them:

- **Quiz and Challenge**: a live run hides the site header and footer through `onActiveChange`; setup, result and error screens bring them back. The shared bottom waterline and sharks remain visible. The Challenge's status is the score, the clock (error colour under 15 seconds) and the fins. Its setup retains `PageHeader`, a panel with topic pills and a Select all / Deselect all link, then `SwimCta` and up to five top scores. Quiz setup uses divided sections for Topics, Questions and Difficulty, a selected-topic count, the unchanged `TopicPill` logos, an inline guest row and a start summary. With no topic selected, a visible helper explains why Start is unavailable before it is pressed; attempted-start errors remain announced.
- **Daily**: `stable={false}` in the `--ss-width-task` column; no hint (no number keys). Check answer, then Practice, with Share as the secondary.
- **Learn level and skill check** (`learn/LessonRunner.tsx`, `SkillCheckRunner` in `Roadmap.tsx`): the `h1` is "Level 1 · Values & Math" (or "Find your level · Round 1 of 4"), a press on an answer grades at once (`verb="answer"`), then Continue, Finish, See the result or Try again is the one `SwimCta` with `focusPrimary`. The intro, the result and every restart screen render inside `QuestionShell` so the exit button does not move. A track colour may tint confetti and the result's icon tile, never text or a button.
- **Shark Cards deck** (`Flashcards.tsx`, `SharkCards.css`): keeps the route's 800px column so the header, tabs and card share one edge; one `QuestionActions` row with Previous and Next together on the left. Face down the primary is "Show the answer"; turned, Got it is the `SwimCta` in the same place.

### Coding frame

One frame wherever a task opens (UX audit U3, #575): `/coding/<track>/<task>` (`CodingWorkbench`, `mode="section"`), a Learn level's coding phase (`mode="lesson"`) and a path's code activity (`CodeActivity` in `ActivityViews.tsx`, `.cd-workbench--activity`). The Learn and path hosts put `ss-wide-page` on their root; on a path module only the frame takes that width. Rules: `client/src/coding/Coding.css`.

| Token | Value | Use |
|---|---|---|
| `--cd-frame-h` | `clamp(600px, calc(100dvh - 7rem - 48px), 900px)` | The frame's one row from 1024px. |
| `--cd-brief-cap` | 120px | The brief's body under its heading, about five lines. |
| `--cd-editor-min` | 280px below 1024px, 200px from 1024px | The editor's floor at every call site. |

- **Code pane**: the editor fills its available height above one 44px action row. The complete `BriefZone`, including the task heading and one Desired complexity, belongs to Description. On section tasks a short Examples group reads only the existing public test calls; large fixtures remain in Results. No hidden checks or reference solutions are exposed by this layout.
- **Actions**: Run is Astryx secondary (`.ss-action`) and Submit is the one `SwimCta` md. Section tasks place Submit after the hint actions on the right; embedded Learn/landing workbenches retain their order. Format and Reset are the editor's `.ss-compact` toolbar (36px icon buttons with tooltips). From 1024px Hint, Solution and Skip are ghost buttons and Report the flag at the far right; below 1024px they fold into one 44×44 "More actions" `DropdownMenu`. Reset still confirms in an inline `role="alertdialog"` note under the action row.
- **Columns**: from 1024px the learner's split (58% by default) with a 1px `--ss-card-line` separator that turns a 3px accent on hover and focus; below 1024px the panes stack.
- **Section workspace** (`mode="section"` only): one outer frame with hairline divisions. Description, Resources and unlocked Solution/Approaches occupy an independent right-hand tab strip. Results, Console and Types or Preview occupy the feedback panel under the editor, so a Run leaves the selected reference open. Feedback can collapse without unmounting the editor/preview and reopens on Run or Submit. The close icon beside the tabs returns to the task’s parent list. A horizontal separator resizes it with pointer or Up/Down, Home/End and Enter to reset; 160–400px, 220px default, saved beside the existing split in `devshark:coding:layout:v1`. Each strip has its own keyboard navigation. Below 1024px Description precedes the unchanged editor opt-in/puzzle; feedback follows the editor.
- **Embedded workbenches**: Learn, path activities and the landing sample retain their existing layout and combined tab strip. The section selectors and editor palette are scoped to `.cd-workbench--section`.
- **Checks**: one divided list of hairline rows with a 3rem status column saying Pass or Fail in words and colour, the call in mono with "→ expected" and "· got actual".

**Coding lists** (`/coding`, FullStack, track pages; `client/tests/coding-lists-layout.test.ts`): one `SwimCta` per screen (the next challenge's Continue); a row's action is `FadeFinCta`. The Premium rule is said once under a list's lead; a row keeps only its "Premium" badge. Task rows are 48px hairline lines (`.cd-row`), two columns from 1024px. A list of more than five projects shows five and a ghost "Show all N challenges". Filters are one row of 44px selects from 1024px. Signed out, a list page says once under its lead that a pass needs an account.

The existing `BrandLogo` and App's bottom waterline with swimming fins are preserved throughout the Coding/Quiz redesign. The Learn redesign proposal is explicitly excluded from this implementation.

### Profile cards and settings rows

- **Card stock**: every Profile card is `.ss-panel` with 24px padding and a `<Kicker as="h2">` on the plain surface. No `.ss-raised` around an Astryx Card. The learning column (Career, Track, the GitHub garden) is on the left; the study advisor, saved questions, 'Your name' and Account are on the right. The identity banner carries the name and plan; appearance and sound stay in the footer.
- **Settings row** (`.de-setting-row`): one row per account action, an `h3` title and a one-line description on the left, its 44px button on the right, a hairline between rows, stacking below 600px. The title names what the action reaches ('All devices'), never the button's words.
- **Name panel** (`SharknameCard`): every name a learner shows is set in one 'Your name' panel: the sharkname field with Generate and Save, then 'Friends see' and 'Leaderboards show' side by side from 400px of panel width (a container query on `.sn-card`). The two settings save on their own.
- **Card disclosure**: a native `<details>` with a 44px `summary` (`.de-disclosure`) for detail a card needs only on request, such as the GitHub garden's 'How it works'.

### Hairline list rows

A list of like items is rows divided by `1px solid var(--ss-card-line)`, never a card per row and never a nested scroll box. A row is one line of 44 to 56px: the title on the left, quiet meta after it, one status or action at the end. Users: coding task rows (`.cd-row`, 48px), the check list, path activity rows (`.lp-activity`, 48px), the Play lobby's players (56px), the `/shop` ledger and offers, the roadmap topic rows (44px), and settings rows. A recorded state is a glyph with its words for a screen reader; a row in its default state says nothing about it.

A short form that is not the page's task (the voucher on `/premium` while checkout is on) is one row without a card: its `h2` on the left, the field (at most 320px) and a secondary button beside it, stacking below 600px.

A summary a learner needs only on request goes below the content it sums up as one closed `<details>` with a 56px `summary` holding the section's `h2` and its count, between hairlines (`.lp-disclosure`, the FDE path's competency evidence).

### Learn section page

`client/src/components/Roadmap.tsx` and `components/learn/*` (UX audit U4, #576).

- **Header**: one in every auth state: the Learn `<Kicker as="h1">` ('Learn'), the section switcher (the only place the section is named), then one supporting line with the section's one action on its right from 768px (`.rm-section-header`). Under 640px the switcher is a list of full-width 44px rows.
- **Topic rail**: at most five tiles a row, shared evenly (`railColumns` sets `--rm-rail-cols`), never narrower than 148px. A locked tile carries one signal: the lock glyph, plus 'Premium' only where Premium opens it, and 'Locked' in its accessible name.
- **Next step**: one 72px row: the fin, 'Level 1 of 25 · Values & Math' with a 4px bar, and the `SwimCta` 'Continue'. When Premium opens that level the line reads '<Topic> is part of Premium' and the button 'See Premium'. Premium is said once per topic, on its tile and in this row.
- **Empty section**: no `StatePanel`; it sits on the column's left edge with an `h2`, one line and one action row.
- **One primary**: while the header offers the join ('Add it to your plan'), the join is the `SwimCta` and every action under it is a 44px secondary.
- **Learning paths** (`components/paths/`): headers stack, the text over one left-aligned action row with the `SwimCta`; the row keeps its 44px (`aria-busy`) while progress loads. The next activity row has a 3px accent edge; a module that Premium opens says 'Premium' once, in its head.
- **Roadmap** (`CareerRoadmap.tsx`, `RoadmapTree.tsx`): the track segment is the page's one track label; each section is one compact list in one `.ss-panel`, a topic listed under its first section only. The map is one row per stage, numbered as drawn.

### Other shared patterns

- **Panel hierarchy**: canvas › one panel › rows. No panel inside a card inside a card.
- **Destructive confirmation**: `BrandedConfirmDialog` (Astryx `AlertDialog`) with a product-specific title, body, cancel and confirm. It runs the confirmed action once. Removing a friend and deleting an account ask through it.
- **Loading**: `LoadingScreen` with the swimming fin, visible status text and one polite live region; never an unlabelled spinner or a fake percentage. A navigation never blanks the page (`DESIGN_RULES.md` §8).
- **Feedback**: semantic tokens plus text or an icon, never colour alone.
- **Empty, error, loading**: one cause, one next action, a stable layout.

## Copy rules

- **Say each fact once per screen.** A count lives on its badge or in its lead, not in both; the Premium rule once per list or topic; the section's name once, in the switcher.
- **The sign-in verb is "Sign in"**, never "Log in" (`check:design` fails a 'Log in' string in `client/src/i18n`).
- **No kicker that repeats the `h1`**, and no lead that repeats the kicker. Leave the kicker out when tabs or the title already say it.
- **A row title never repeats its button.**
- **The lead is the scope sentence**: what the page shows, in one line under the `h1`.
- All reusable copy is an English key in `client/src/i18n/translations.ts`, or in the route's own dictionary beside it (`translations.learn.ts`, `translations.paths.ts`, `translations.question.ts` and the others) so it stays off the first download. devShark ships English only.
- Public facts come from the registries, not literals. Curated explanations are authoritative; devShark ships no AI feature. Never generate product screens, scores, users, testimonials or factual teaching diagrams.

## Apple layer

`client/src/main.tsx` sets `data-design="apple"` on `<html>` before the first paint, so every page renders with the layer. Its rules sit under `:root[data-design='apple']`:

- Tokens: the system font stack, neutral text and surface colours through `light-dark()`, the radii above, larger display and title sizes, a 100ms feedback duration and two-layer shadows. Dark mode keeps the Deep End blue-green background.
- Chrome (`app-shell.css`): a floating, rounded, translucent header with backdrop blur; pill nav links at least 44px tall with an accent ring on the active one; a translucent drawer; translucent dialogs over a darker backdrop.
- Surfaces and controls: panels and raised cards take a 1px border, buttons are pills, inputs take `--radius-element`, radio cards sit on the muted background. Buttons, nav links, radio cards and strip tiles scale to 97% while pressed.
- Preferences: reduced motion drops the press scale, reduced transparency swaps blur for solid surfaces, and `prefers-contrast: more` gives the header, drawer, dialogs, panels and radio cards a solid surface with a text-coloured border.

The production CSS purge keeps `data-design` selectors, and the build fails if the `:root[data-design='apple']` token block goes missing (`client/vite.config.ts`).

## Semantic layers

- Canvas: body, elevated, surface, muted.
- Text: primary, secondary, disabled, on-accent.
- Structure: border, strong border, card line, tactile card edge.
- Interaction: focus, hover, selected, disabled.
- Feedback: success, warning, error, info, with strong and soft variants where needed.
- Brand: accent, accent-soft, accent-contrast, waterline, grain, wave.
- Depth: low, medium and high elevation, overlay scrim.

Use only defined semantic names, and keep factual visualization colours out of the accent system.

## Layout and accessibility

- Keep the fixed header, the internal main scroll, the persistent waterline and at least 44px of bottom-ocean clearance.
- One `h1` per route, real landmarks, visible theme-safe focus on every interactive element.
- Radio groups use roving focus and Arrow/Home/End. Dialogs and the drawer trap focus, close on Escape, have a close button and restore focus.
- Status uses text or an icon plus semantic colour; timers announce only meaningful thresholds.
- Validate at 360px, at 400% reflow and in both themes.

## Accepted activity refinements — 5 November 2026

Breadcrumb renders only when it contains at least two values, including the current leaf. Root sections do not duplicate their title. Mounted QuestionShell, non-landing CodingWorkbench, `.ss-focus-page` or `[data-activity="active"]` hide global chrome and informational footer while preserving local actions and ocean/sharks. The route uses safe auto margins for vertical centering; taller content scrolls from its beginning. Operational h1 uses `--ss-type-page-title` (29px), body 16px; public hero typography is unchanged.
