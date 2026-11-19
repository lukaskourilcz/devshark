# Repository instructions for coding agents

Audit before editing: inspect Git state, trace the route/data flow, read the copy dictionary in `client/src/i18n/translations.ts`, and search for reusable registries, components, hooks, styles, dialogs, and tests. Preserve unrelated user work.

This repository builds devShark, the `webdev` developer-learning product, and nothing else. StudyShark moved to its own repository (`lukaskourilcz/studyshark`) on 2026-09-24; do not add it, its subjects or links to it back. Product identity, subjects, counts, and accents come from `client/product-catalog.ts`, `shared/subject-catalog.ts`, and their existing adapters. The footer carries only the legal links, devShark's own social profiles and the appearance and sound controls. devShark ships English only, for good: write all copy and content in English and add no second language, translation overlay or language switch.

devShark is freemium. `shared/tiers.ts` is the only place that says what the free tier includes and what Premium opens; the server refuses locked content with 402 and the client only mirrors it. Premium, coins, cosmetic shop items, Shark Cards (saved questions) and badges change which content a learner may start and nothing else: never grading, explanations, XP amounts, scores, streaks, ranks, leaderboards, matchmaking or AI availability. Streak protection is the one bounded exception: two a month are granted free, extra ones cost coins earned by learning, the ceiling never rises above two, and a protection changes the day count of a streak and nothing else; no leaderboard here ranks by streak. Merchandise is paused until next quarter behind `MERCH_ENABLED` in `shared/rewards.ts` (owner decision, 1 October 2026): while it is off nothing shows or sells merchandise, and the server refuses merchandise orders and the learning-path package with 404 `merch_unavailable`. When it returns, finishing a whole learning path earns the merchandise package, a reward *for* learning that changes no progress; merchandise is printed and shipped by Spreadshop, and coins redeem items, never discounts. devShark ships no AI feature. See `shared/rewards.ts` and the "Tiers and billing" section of `docs/product-architecture.md`.

The server remains authoritative for answers, grading, scores, XP, entitlements, subject/product scope, roles, and claims. Keep Supabase/RLS/service-role isolation and exactly twelve physical TypeScript handlers under `api/`. Do not add native/Expo code.

Extend Astryx and Deep End v2 through `client/src/styles/astryx-theme.css`, `client/src/styles/app-shell.css`, `DESIGN_RULES.md`, `client/src/components/ui/`, and existing Shark/landing primitives. Do not add another UI, icon, dialog, toast, localization, state, product, or subject system. Use `.claude/skills/generated-media-production/SKILL.md` for meaningful media; keep authentic UI and factual visuals deterministic, review three directions, and record provenance. Before recommending or using a generator, research at least three current cheap or free services from official pricing, licensing, privacy, and model documentation. Never alter billing without explicit owner authorization.

Page widths and control heights are shared tokens chosen once (`DESIGN_RULES.md` §10): the route shell picks each route's width from `client/src/components/ui/pageWidth.ts`, every control is 44px on every pointer (36px only inside `.ss-compact` toolbars), and a page never sets its own page `max-width` or button size.

Every screen change covers relevant loading, empty, error, offline, auth/permission, disabled, success, destructive, stale/expired, long-content, and narrow states. Validate focus/keyboard, names/errors/status, non-color cues, reduced motion, touch targets, zoom/reflow, light/dark, and widths 360 through 1440.

Authoritative references:

- `docs/product-architecture.md`
- `DESIGN_RULES.md`
- `docs/design/`
- `.claude/skills/`
- `.claude/agents/`
- `.claude/commands/`
- `docs/curation-claims.md` — what may be said about content review, and why
  every claim fails closed
- `docs/practice-scheduling.md` — the spacing and interleaving policies, kept
  apart on purpose
- `docs/release-acceptance.md` — the acceptance matrix: every gate with its
  actual result, and every check that could not run

Release commands are `npm run typecheck:api`, `npm run test:launch`, `npm run build`, `npm run check:responsive`, `npm audit --omit=dev`, `npm audit --omit=dev --prefix client`, and `git diff --check`. They are the inner loop. The required `verify` CI job passes only when the quickjs, client-build, static, tests, coding, browser and container jobs of `.github/workflows/quality.yml` pass; `npm run ci:parity` runs their 44 steps locally in the same order (`.claude/skills/ci-parity-and-pr/SKILL.md` says when `--fast` is enough). Merge only through a pull request with `verify` and `sql` green. Record actual outcomes. Stage only coherent intended files, leave unrelated work untouched, and commit incrementally.

## Repository workflows

The installed workflows below are the working map. Read the relevant source before applying it. Vendored skills keep their upstream instructions.

Skills: [api-operation](.claude/skills/api-operation/SKILL.md), [ci-parity-and-pr](.claude/skills/ci-parity-and-pr/SKILL.md), [coding-task-authoring](.claude/skills/coding-task-authoring/SKILL.md), [deep-end-design-system](.claude/skills/deep-end-design-system/SKILL.md), [find-skills](.claude/skills/find-skills/SKILL.md), [generated-media-production](.claude/skills/generated-media-production/SKILL.md), [github-issue-authoring](.claude/skills/github-issue-authoring/SKILL.md), [learn-question-authoring](.claude/skills/learn-question-authoring/SKILL.md), [learning-path-module-authoring](.claude/skills/learning-path-module-authoring/SKILL.md), [markdown-checkup](.claude/skills/markdown-checkup/SKILL.md), [preview-video](.claude/skills/preview-video/SKILL.md), [route-and-chunk](.claude/skills/route-and-chunk/SKILL.md), [section-code-audit](.claude/skills/section-code-audit/SKILL.md), [session-end](.claude/skills/session-end/SKILL.md), [session-start](.claude/skills/session-start/SKILL.md), [shark-learning-content-map](.claude/skills/shark-learning-content-map/SKILL.md), [shark-product-context](.claude/skills/shark-product-context/SKILL.md), [shark-release-validation](.claude/skills/shark-release-validation/SKILL.md), [shark-screen-implementation](.claude/skills/shark-screen-implementation/SKILL.md), [stop-slop](.claude/skills/stop-slop/SKILL.md), [supabase](.claude/skills/supabase/SKILL.md), [supabase-migration](.claude/skills/supabase-migration/SKILL.md), [supabase-postgres-best-practices](.claude/skills/supabase-postgres-best-practices/SKILL.md), [task-observer](.claude/skills/task-observer/SKILL.md), [ui-ux-pro-max](.claude/skills/ui-ux-pro-max/SKILL.md), [visual-qa-accessibility](.claude/skills/visual-qa-accessibility/SKILL.md).

Agents: [accessibility-visual-qa-reviewer](.claude/agents/accessibility-visual-qa-reviewer.md), [content-curator](.claude/agents/content-curator.md), [design-system-engineer](.claude/agents/design-system-engineer.md), [generated-media-art-director](.claude/agents/generated-media-art-director.md), [migration-reviewer](.claude/agents/migration-reviewer.md), [path-content-author](.claude/agents/path-content-author.md), [product-copy-reviewer](.claude/agents/product-copy-reviewer.md), [product-design-auditor](.claude/agents/product-design-auditor.md).

Commands: [add-api-op](.claude/commands/add-api-op.md), [audit-reuse](.claude/commands/audit-reuse.md), [ci-parity](.claude/commands/ci-parity.md), [content-snapshot](.claude/commands/content-snapshot.md), [design-audit](.claude/commands/design-audit.md), [generate-shark-media](.claude/commands/generate-shark-media.md), [implement-screen](.claude/commands/implement-screen.md), [new-migration](.claude/commands/new-migration.md), [pr-merge](.claude/commands/pr-merge.md), [release-validate](.claude/commands/release-validate.md), [review-copy](.claude/commands/review-copy.md), [visual-qa](.claude/commands/visual-qa.md), [write-issue](.claude/commands/write-issue.md).
