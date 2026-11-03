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

## Verification in progress

Coding's 16 new browser cases pass, including seven widths in both themes. Quiz's 20 browser cases and 62 focused unit cases pass; the final deadline-placement assertion will be rerun on the integrated build. Learn's focused units pass, including shared radio-card behavior and touched lock explanations. Integrated browser, type and bundle gates and the required PR checks are still in progress.

The first integrated unit run passed 1,788 of 1,795 tests; it exposed an outdated bulk-selection label and timing assumptions under simultaneous builds. Follow-up changes use valid typed role queries, provide the workbench's required initial code, explicitly release delayed Learn progress, and verify eager reading via the boundary-render contract rather than CPU wall time. No product behavior was changed to satisfy those timing assertions.
