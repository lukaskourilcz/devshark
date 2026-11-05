# Whole-application design review · 5 November 2026

Review and proposed before/after concepts, not approved product implementation. Baseline: product merge #599 (`2ff184bc`), documentation closeout #600 (`bba113ce`). The earlier approved redesign remains live while this review is prepared.

## Owner’s current direction

- The Coding home’s first screen is the accepted scale and gutter reference. Preserve its four-track overview, original logo, Quiz topic pills/logos and bottom waterline/sharks. Reorganize the lower Coding page; make the light next-challenge surface distinguishable.
- Bring other operational pages toward that scale and width. The earlier general 20% reduction is now a direction for oversized areas, not a request to shrink the approved Coding header again. Keep readable prose, code and usable targets.
- Add contextual breadcrumbs throughout. Every coding task starts directly with one editor card, with no external title or level strip. Its top strip uses linked `coding / javascript / linkShortener1.js`; the next level is `linkShortener2.js`. Use challenge-specific camelCase names, appropriate extensions and a breadcrumb target matching the language/type (including FullStack).
- Put Description, Results and Console in one right-hand tab strip. Only authorised server Submit results may unlock Solution; local Run does not. Keep required React/TypeScript feedback available within the same workspace.
- Put Format, Reset, Skip, Star and Flag in the compact top toolbar. Bottom actions: Run, Hint and Submit. Put the evolving/FullStack level navigation below the card, not above the editor. Preserve accessible locked/current/completed states and prior no-“Current” label decisions.
- Hide global navigation during coding, challenges and question answering, across all entry points. Preserve context, return/recovery, grading, drafts and the bottom ocean.
- Desired complexity is one short line at the very bottom of Description after Examples.
- Profile: Account belongs in the left column directly under Track and Sections. Preserve existing confirmations and security behavior.
- Today: the Learning paths activity/title/action must not concatenate into an unstyled browser-blue link. Reuse the existing Today card anatomy.

## Evidence collected

Native Uizze MCP connected and registered all three tools. Executed 19 tool calls: 12 discovery searches, one exact three-screen inspection, four flow/sequence retrievals and two material searches. There are 58 unique returned reference IDs. Seventeen images from twelve products were inspected, including every step of two recorded learning flows (Duolingo, three; Khan Academy, four). The other two sequences are web page-section collections, not recorded user journeys. `references.json` records queries, exact/closest limitations, inspected images and transferable/rejected lessons. No Pack or dependency was installed; the existing system font and icon system remain the proposed baseline.

Production guest observation: 37 requested route targets, 63 route/theme/viewport cells, 1280×800 and representative 1440×900 / 390×844, plus lower Coding scroll captures. All captured with no page error or document overflow. Every non-read request matching `/api/` was blocked, including one telemetry envelope request; none was sent. These guest views do not establish authenticated or submitted states. Those use local, labelled fixtures in the follow-up captures. `observations.json` holds measured geometry and typography, not inferred usability metrics.

Primary guidance: [W3C breadcrumbs](https://www.w3.org/WAI/ARIA/apg/patterns/breadcrumb/), [reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), [44px enhanced targets](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html), [text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). These complement visual references; they do not establish full application conformance.

## Confirmed source anchors

- Width: `client/src/components/ui/pageWidth.ts:21`, `client/src/styles/astryx-theme.css:41`: Coding is capped at 1200px, most other routes at 800px, questions/setup inside 640px. Measured at 1280px: Coding starts at x=38, Learn/Today at x=238, Quiz contents at x=318.
- Scale: the observed Coding operational h1 is 29px, while Daily’s is 47.04px at the same viewport. The proposal uses the approved Coding scale as its operational reference.
- Focus: `client/src/App.tsx:562` hides chrome only for active Quiz/Challenge/Learn state. Coding tasks, Daily and other question entry points need a common activity contract.
- Coding lower hierarchy: `client/src/components/coding/CodingSection.tsx:517` appends run planning, debugging, evolving, FullStack and technique groups; `client/src/coding/Coding.css:68` switches between unrelated list/feature geometries.
- Light resume surface: `client/src/coding/Coding.css:44` mixes 7% accent with the surface. Its low distinction is an owner-reported hierarchy issue, not a claimed text-contrast failure.
- Today: `client/src/components/paths/PathResumeSection.tsx:59` emits `today-item*`, while the supplied styling is `today-card*` in `Today.css:111`; no `today-item` selectors exist. This explains the supplied unstyled-link state. Reuse the existing card styling rather than introduce another row system.
- Profile: `client/src/components/Profile.tsx:315` defines the two columns; AccountDeletionCard currently appears in the right column at line 372, while LearningPathsCard is in the left column.

## Deliverable and decisions

Open [the standalone interactive review](index.html). It contains 27 independently commentable decisions, 33 matched screenshot pairs across 16 scenes, the inspected Uizze reference gallery and explicit coverage limits. Each decision has stable ID, evidence, proposed behavior, dependencies and an implementation check. Confirmed defects, owner requests, design proposals and verification conditions are labelled separately.

The full-size editor concept uses `coding / fullstack / linkShortener1.js` with linked real parents, a common right tab strip and a stage row below the card. The following level's display-name rule is camelCase plus the stage number, for example `linkShortener2.js`; native TypeScript contexts retain their corresponding `.ts` label. These are display names, not changes to grading entrypoints. Classic JavaScript uses `digitSum.js`.

The default Coding first fold remains the scale reference. The lower catalogue, focus contract, Today path styling, Profile Account placement, Learn topic hierarchy and Quiz grouping are separate decisions so they can be accepted or revised independently. Original logo, Quiz topic pills/logos and ocean/sharks remain intact. No “Current” stage word, optional-reading warning, Skip to questions or placement-recovery change is proposed.

Comments and decisions autosave in this browser/origin only. Export/import JSON is the transfer mechanism; no automatic message or backend write occurs. An HTML refresh keeps the same storage key and finding IDs. [QA.md](QA.md) records the 25 document checks, screenshot method and limitations; `review-qa.json` binds the results to the HTML SHA-256.

No product CSS, route, auth, grading, server, schema, reward or access rule is changed by this review branch. Implementation starts from the owner's decisions, not from treating these concepts as already approved.
