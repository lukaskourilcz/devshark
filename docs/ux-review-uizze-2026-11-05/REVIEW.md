# devShark · Uizze UX overview

Requested scope: a brief redesign overview and representative before/after examples, not a component-by-component audit or a production implementation. Product interfaces remain English; the owner's report is Czech.

## Evidence

- Actual guest production captures of Coding home, Digit sum, Learn Web Developer/HTML and Quiz setup, at 1280px in both themes and 390px in dark mode. Capture window: 4 November 2026 UTC / 5 November Europe/Prague. No app API writes, page errors or document overflow in those 12 observations. This is not authenticated, grading, offline or full accessibility acceptance.
- Existing Apple layer, Deep End neutrals, brand geometry and the single green accent stay authoritative. Sources: `DESIGN_RULES.md`, `client/src/styles/astryx-theme.css:210`, `client/src/styles/app-shell.css:934`.
- Uizze anti-ui-slop 1.3.1, audit/distill/polish playbooks, read directly from the public upstream skill: https://github.com/uizze/uizze/tree/main/skills/anti-ui-slop . No upstream scripts executed and no design Pack installed.
- Uizze registered `find_ui_references`, `find_ui_materials` and `get_ui_flow` in a freshly started native Codex CLI session. One actual `find_ui_references` call succeeded. It returned supporting editor examples, explicitly no exact learning/challenge/requirements match: [HTMLDrop](https://uizze.com/packs/223f9b3d-be89-4ec4-8ecb-7edad5e4aca0), [Evidence](https://uizze.com/packs/c844f5f2-ec2e-4ac2-b300-cc2d0e7d9ea2), [Hoppscotch](https://uizze.com/packs/1983f755-a03a-480a-b9ad-05f60fa2ec2e). The Hoppscotch request editor image was inspected: input, tabs and response are separated by hairlines, with results below input. Transfer that grouping, not its colors, branding or density. HTMLDrop and Evidence are listed as returned matches, not visually verified references.
- Credentials are exclusively in private user-level agent configuration, outside this repository. This report contains no credentials or MCP configuration contents.

## Priorities and recommendations

1. **Learn / observed mobile hierarchy, P1:** all ten topic tiles and the three-section switcher precede Continue; at 390×1000 the next-step card starts around y=785. Put the current lesson first after a compact section/topic selector. Offer the full topic list through a labelled disclosure on mobile, a quiet sidebar on desktop. Keep every topic reachable, locks inspectable, section progress available and the guest/account progress distinction explicit. Source: `client/src/components/Roadmap.tsx:1177`, topic rail and section controls in the same component. This is a hierarchy finding, not a claim that the current page is broken.
2. **Coding workspace / design hypothesis, P2:** the editor and Description already work beside each other. Preserve the right-hand Description and single Desired complexity, but replace nested panel edges with a shared workspace frame and keep an optional results area below code. Display examples and input bounds as scannable groups. This should reduce switching between instructions and feedback; confirm with an actual write → Run → diagnose → Submit task before implementation. Source: `client/src/components/coding/CodingWorkbench.tsx` and `CodingSection.tsx`. Existing mobile editor opt-in stays.
3. **Quiz / observed setup state, P2:** the empty selection makes Start quiz unavailable, while the visible empty-state guidance is currently deferred to an attempted start. Show a quiet inline 'Choose at least one topic' message before interaction, plus a compact summary beside Start. Consolidate the guest notice and Sign in into one subordinate row. Keep all five difficulty choices and question-count controls visible. Source: `client/src/components/Quiz.tsx:1004`–`1085`. Actual keyboard/screen-reader behavior is not declared defective by this visual review.
4. **Shared visual hierarchy / optional direction, P2:** use neutral operational headings and reserve green for the selected context, progress and primary action. Use spacing and dividers for dense work; keep surfaces for meaningful groups. Preserve brand, dark ocean background, system type, 44px targets, themes and reduced motion. This is a preference to evaluate, not an accessibility failure.

## Three directions considered

- A · Surface polish: adjust contrast, typography and borders only. Small scope, but leaves the mobile Learn ordering unchanged.
- B · Task first: keep the design system, reorder the next action, reduce containers and use contextual disclosure. Recommended; illustrated in the report.
- C · New visual identity: change palette, fonts and chrome. Adds broad cost without an observed workflow benefit in this sample; not recommended.

## Reuse and boundaries

Extend `LearnPageHeader`, `PageHeader`, the existing section/topic selectors, `StatePanel`, `CodingWorkbench`, `RadioCardGroup`, `TopicPill` and `SwimCta`; use existing width, color and radius tokens. The HTML concepts are review artifacts, not another production component library. No progress, rewards, tier, authorisation, answers, grading or database behavior is redesigned. Automatic latest unfinished Coding continuation remains as shipped. C04/C06/C07/L03 owner overrides and the L04 exclusion remain in force.

## Before implementation

Validate the concepts with one primary task and one recovery path per area. Cover current/locked/completed and long titles, error/retry, guest/signed-in, narrow/desktop, keyboard/focus, zoom and both themes. Compare the current and proposed layout using the same data. Do not infer a speed or conversion gain from a screenshot. The proposed screens are illustrative HTML, not a verified product build.
