# devShark UX audit, round three — 5 November 2026

Review the shipped application at `ca5900282d5e4cc2aa115d5d02585ac056a6d58d`, after #603 and #604. Before means this current application, not an earlier design proposal. After will be a clearly labelled visual concept awaiting owner decisions; this review changes no product behaviour.

## Scope and constraints

- Fresh production guest capture: 18 routes in light/dark at 1280×680 and light at 390×844, 54 cells. No document overflow, page errors or attempted writes were observed. `coverage.json` records the cells.
- Signed-in and completed-work examples use a fresh build of that same commit, placeholder Supabase configuration and a fictional local Test Learner. Every account/API response is intercepted locally. Missing optional fixture data is not evidence of a product defect.
- Keep the approved logo, Quiz pills/logos and the ocean/sharks. Keep the owner's accepted workspace, route widths, typography, card placement and focus rules. Do not reopen rejected Premium/auth/public redesign or previous reading, placement and End/Cancel exceptions.
- Consolidate each underlying problem once, with its affected instances, a concrete before/after pair and an implementation/verification boundary. Previously shipped improvements are the baseline, not new findings.
- Preserve grading, saved drafts, XP, gates and server authority. This is an expert review, not a claim of usability tests with learners or physical-device acceptance.

## Research

The native Codex host registered `find_ui_references`, `find_ui_materials` and `get_ui_flow` and connected to the existing private user-level Uizze entry. The initial seven successful searches returned closest matches. These are layout references, not proof of the missing interactions. A later playground search returned a temporary service error and failed its single retry; no empty-result inference is made.

Primary guidance consulted: [W3C tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/), [NN/g visibility of system status](https://www.nngroup.com/articles/visibility-system-status/), [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) and [NN/g empty states](https://www.nngroup.com/articles/empty-state-interface-design/). The final report will identify which inspected references inform which proposal and distinguish observations from design judgments.
