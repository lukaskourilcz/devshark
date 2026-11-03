# Approved UX implementation

The owner requested implementation of the Coding, Learn and Quiz audit on 3 November 2026, with the exceptions below, and explicitly authorised the FDE path launch. Product UI stays English. This checklist records implementation and verification rather than treating the original audit mockups as the final specification.

The initial Description change is merged through PR #594 at `0744084b`, with all required checks green. The 16 individual commits were preserved by a merge commit.

## Owner overrides

- C04: no confirmation dialog. End/Cancel and “Completed challenges stay saved.” belong in one action row; remove the unnecessary separate button rows.
- C06/C07: no visible “Current” label. The current stage number uses the existing green accent; retain accessible current-step semantics and useful prerequisite explanations.
- L03: remove “Reading is optional. It records no progress and earns no XP.” and the Skip to questions action. Add no replacement skip action.
- L04: do not implement the proposed placement-restart recovery wording.

## Coding

- [x] C01: prioritize the active run and real unfinished work, without invented recency.
- [x] C02: distinguish unavailable/stale data from zero progress.
- [x] C03: distinguish Saved errors from an empty collection; retain safe serialized writes and retry feedback.
- [x] C04: apply the owner's single-row run actions.
- [x] C05: correct FullStack route hierarchy and remove repeated technology metadata.
- [x] C06: one persistent project/stage context, with the owner's current-stage treatment.
- [x] C07: accessible, specific prerequisite explanations, without a Current label.
- [x] C08: consistent task-type filters and compatible old URLs.
- [x] C09: project action names include their target.
- [x] C10: previous-requirements disclosure meets the shared touch target.

## Learn

- [x] L01: continue to available checkpoints as well as levels.
- [x] L02: make exact lock reasons reachable by keyboard and touch.
- [x] L03: apply the owner's reading-copy/action removal.
- L04: excluded by the owner; preserve existing behavior.
- [x] L05: real, correctly named FDE shelf actions.
- [x] L06: consistent topic/path and learning-plan recovery labels.

## Quiz

- [x] Q01: preserve hidden topic choices in visible bulk operations.
- [x] Q02: make unanswered questions and their return action discoverable.
- [x] Q03: prioritize learning from incorrect answers, retaining all reviews.
- [x] Q04: persistent, account-scoped result-save status using the existing receipt queue.
- [x] Q05: visible difficulty explanation.
- [x] Q06: preserve the current quiz mode's identity.
- [x] Q07: move focus as well as scroll to review.
- [x] Q08: loading cancellation and recoverable state focus.
- [x] Q09: explain guest persistence before starting.
- [x] Q10: show the actual issued deadline while keeping the server authoritative and preserving answers.

## FDE rollout

- [x] Verify current content is launchable under the existing catalogue validator.
- [x] Verify the production project and learning-path storage metadata without reading learner data.
- [x] Confirm RLS on all five learning-path tables and service-only execution of migration 066's quota acceptance function.
- [x] Set `LEARNING_PATH_FDE_ENABLED=true` for Production only, as authorised by the owner.
- [x] Verify the corresponding production deployment is READY.
- [x] Verify settings/catalogue report FDE available and guest path pages render at desktop and narrow widths.

READY production `dpl_FkqzWx8MSztcEaMNmdNYXBwEMbZZ` at PR #594 merge `0744084b` picked up the production environment change; eight real guest browser cells passed at 390px and 1280px. No new schema, grading, reward, account, tier or handler changes are planned. Existing authenticated production acceptance remains a separate owner walkthrough; the rollout checks create no learner results.

## Local verification — 3 November 2026

- API, scripts and tooling type checks pass; public/design, unused and security checks pass.
- Combined application build passes. The production-shaped bundle is 231,726 / 241,651 gzip bytes; monitoring is 49,500 / 60,000. Both production dependency audits report zero vulnerabilities.
- Integrated browser run: 102/103 pass initially; the transient XP-toast test passes separately. Its expected clock text is now computed before Submit so the test does not spend the toast's display time on an extra browser evaluation. Final targeted rerun passes.
- Coding's 16 audit cases, all original Description/workbench/evolving/draft cases, Quiz's 20 audit cases (including the final expiry geometry assertion), and reading in both themes are covered by the integrated run and follow-up.
- Learn: seven focused browser cases pass, including actual first/final checkpoint questions, keyboard and touch locks, and reading. The 42-cell sweep (three states × seven widths × two themes) reports no overflow or page errors; FDE shelf axe checks find no violations in either theme.
- The report itself passes seven widths, embedded-image decoding and filter checks, and includes seven actual post-change screenshots.

The first integrated unit run passed 1,788 of 1,795 tests. Follow-ups corrected an outdated guest bulk-selection fixture, typed role queries and required initial code, a delayed-progress race, and an eager-reading wall-time assumption. The seven initially failing cases pass in follow-up runs, alongside all 62 Quiz cases and the workbench regression cases. No product behavior was changed to satisfy timing assertions.

PR #595 is merged at `7519a27b9ab436391c1feb844e3dc7a643f804e4` with all required checks green (run `41672475795`). All 187 client test files and 1,795 tests pass in CI. READY production `dpl_7Tdf44Ja1WvrW3BZtYgLP8CoS4CN` matches that merge and serves devshark.app. Twelve real guest route/width cells pass at 390px and 1280px, with no overflow, page errors or API writes; FDE remains enabled and available. Authenticated production acceptance remains an owner walkthrough, as recorded in NEEDED.md.
