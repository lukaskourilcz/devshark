# Senior UX audit: Coding, Learn and Quiz

You are the lead product designer and senior UX auditor for devShark. Audit the actual application in `https://github.com/lukaskourilcz/react-express-app`, starting from current `main`. Read `AGENTS.md`, `DESIGN_RULES.md`, `docs/product-architecture.md`, the design-system catalogue and the relevant local skills. Preserve unrelated work. Make frequent, small, meaningful commits with the repository author's existing Git identity; do not create empty commits or rewrite history to inflate counts.

## Deliverable and boundaries

Deliver a comprehensive UX audit and **one self-contained HTML report**, in Czech, with English proposed UI copy. Include actual current screenshots and deterministic before/after prototypes for each recommendation. Embed assets, styles and scripts so the HTML opens locally without a server or third-party dependencies. Clearly label actual screenshots, schematic reconstructions, proposed UI, fixture states and anything not tested. The report must distinguish confirmed behavior from hypotheses and shipped fixes from future proposals. Do not implement the audit recommendations in the product unless separately requested.

The starting baseline already moves the complete coding brief (title, metadata, difficulty, prompt, glossary, previous requirements and Desired complexity) into the right card's default **Description** tab. The editor occupies the left card. The full Target line is absent from visible descriptions; authored targets remain available to server complexity guidance. Confirm this baseline on the checked-out commit; do not count it as a new open finding.

## Parallel responsibilities

1. The lead owns **Coding challenges**: discovery, classic track/task lists, JavaScript, TypeScript, React, algorithms, debugging paths, evolving projects, FullStack, individual stages, saved tasks, practice sessions, drafts, hints, visible checks, Run/Submit and completion. Derive the complete route and format inventory from `App.tsx` and the existing registries. Do not revive hidden or retired formats.
2. Start one parallel agent for **Learn**: section selection, topics, map and levels, prerequisite locks, lessons, skill checks, checkpoint tests, coding activities, progress, completion and the enabled FDE path.
3. Start a second parallel agent for **Quiz**: configuration, scope/filtering, question count, difficulty, active questions, skipped/unanswered items, navigation, restore/expiry, submission, grading, results, explanations, retries and the next learning action. Include relevant daily/review entry states without confusing the separate daily page with Quiz.

Assign separate report files to agents. They must not switch the shared branch or edit the same files. Each agent reports its inspected commit and evidence, preserves existing strengths, and produces before/after examples. The lead reviews and deduplicates all findings, then integrates them into the final HTML. Keep area reports separately readable as well.

## Investigation

- Trace each flow from route to component, copy dictionary, styles, hooks, API helper and existing handler. The repository uses multiplexed Vercel handlers, not a separate inferred Express service.
- Inventory repeated facts and controls both within a screen and across routes. Look for duplicate titles, progress, task context, lock explanations, empty states, actions, labels and competing ways to start the same task. Distinguish useful context from unnecessary repetition.
- Evaluate goal clarity, information hierarchy, labels, affordances, action priority, discovery, progressive disclosure, navigation, return paths, learn/practice continuity, error recovery and whether the next useful action is visible.
- Audit actual loading, delayed, empty, error, offline/reconnect, signed-out, free/Premium, disabled, success, destructive, stale/expired, long-content and narrow states. Mark each state as browser-tested, source-inspected or not tested; do not claim a full matrix from a few screenshots.
- Inspect widths 360, 390, 430, 768, 1024, 1280 and 1440 in light/dark, plus reduced motion and reflow where relevant. Check keyboard order, tab-arrow behavior, focus after transitions and retries, screen-reader names/status, non-color cues, touch targets, contrast, scroll ownership and shell clearance.
- Build and serve the real client. Prefer existing deterministic browser fixtures; never create accounts, scores, payments or messages on production for an audit. Use local failure injection for error cases. Preserve real product content and render enough of each full flow to test the recommendation.
- Search the shared component catalogue before proposing UI. Favor `PageHeader`, `LearnPageHeader`, `StatePanel`, `CodingWorkbench`, `BriefZone`, shared question parts, `SwimCta`, `BrandedConfirmDialog`, existing tokens and registries. Identify the smallest correction and its reuse points; avoid a second design system.
- Preserve English-only product copy, server grading and access authority, draft safety, stable answer order, lazy loading and existing visual identity. Recommend no new AI features, subject registries, handler families, fabricated metrics or changes to reward fairness.

## Required finding format

For every finding provide:

- Stable ID, area, route, scenario and affected user.
- Priority P0/P1/P2 and explicit confidence; reserve P0 for demonstrated inability to complete a core task or loss of work.
- Current behavior with reproducible steps, source `path:line`, inspected commit, and screenshot or fixture evidence.
- Why it matters in concrete user terms, without invented conversion or retention numbers.
- The smallest proposed change, exact English UI copy, existing reusable parts and affected files.
- A before/after pair showing the same task, viewport, data and state. Actual screenshots must remain unaltered; label designed after states as proposals.
- Acceptance criteria, browser checks, regression risks, effort S/M/L and dependencies.

## Final HTML

Open with the principal problems and recommended sequence. Provide filters by area/priority and a comparison layout that works on desktop and phones. Include:

1. Audited scope, commit, methods, coverage and limitations.
2. Strengths that should survive the redesign.
3. Deduplicated prioritized backlog across Coding, Learn and Quiz.
4. Concrete before/after comparisons and clickable prototypes for key interactions.
5. Shared improvements mapped to existing components, avoiding three parallel implementations of the same fix.
6. File-level implementation order, effort, dependencies and measurable acceptance criteria.
7. Executed validation matrix and honest gaps.

Render and visually inspect the final HTML at desktop and mobile sizes. Verify all links, embedded assets, filters, comparisons, keyboard focus and print layout. Commit report, prototypes and reusable prompt in small coherent steps. Report the path to the HTML, the most consequential findings and the actual verification results. If merging deliverables is requested, use a PR with `verify` and `sql` green and preserve the individual commits through a merge commit.
