# devShark UX audit, round three — 5 November 2026

Review the shipped application at `ca5900282d5e4cc2aa115d5d02585ac056a6d58d`, after #603 and #604. Before means this current application, not an earlier design proposal. After is a clearly labelled visual concept awaiting owner decisions; this review changes no product behaviour.

Open `index.html` directly, or serve this directory on localhost:4185. It contains ten independent decisions, thirty matched pairs (sixty screenshots), theme/viewport selection, image zoom, six inspected Uizze references and local feedback with validated JSON import/export. The new schema, IDs and storage key do not overwrite earlier rounds. Export filename: `devshark-ux-review-kolo3-komentare.json`.

## Scope and constraints

- Fresh production guest capture: 18 routes in light/dark at 1280×680 and light at 390×844, 54 cells. No document overflow, page errors or attempted writes were observed. `coverage.json` records the cells.
- Signed-in and completed-work examples use a fresh build of that same commit, placeholder Supabase configuration and a fictional local Test Learner. Every account/API response is intercepted locally. Missing optional fixture data is not evidence of a product defect.
- Keep the approved logo, Quiz pills/logos and the ocean/sharks. Keep the owner's accepted workspace, route widths, typography, card placement and focus rules. Do not reopen rejected Premium/auth/public redesign or previous reading, placement and End/Cancel exceptions.
- Consolidate each underlying problem once, with its affected instances, a concrete before/after pair and an implementation/verification boundary. Previously shipped improvements are the baseline, not new findings.
- Preserve grading, saved drafts, XP, gates and server authority. This is an expert review, not a claim of usability tests with learners or physical-device acceptance.

## Research

The native Codex host registered `find_ui_references`, `find_ui_materials` and `get_ui_flow` and connected to the existing private user-level Uizze entry. The initial seven successful searches returned closest matches. These are layout references, not proof of the missing interactions. A later playground search returned a temporary service error and failed its single retry; no empty-result inference is made.

Two subsequent `get_ui_flow` requests returned twelve web page sections. Those are not recorded navigation journeys. Six native inline images were actually inspected and embedded, with exact reference IDs in `references.json`; the direct CDN download refused access, so no credential was sent to it. `research-log.json` records closest-match limits and the one failed search plus its failed retry. No new font/icon system is proposed.

Primary guidance consulted: [W3C tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/), [NN/g visibility of system status](https://www.nngroup.com/articles/visibility-system-status/), [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) and [NN/g empty states](https://www.nngroup.com/articles/empty-state-interface-design/). The report separates direct observations, design judgments and reference inspiration.

## Decisions, without repeating shipped findings

| ID | Proposal |
|---|---|
| R3-01 | Daily: retain the new context while bringing all four answers and Check answer into the short notebook viewport |
| R3-02 | Learn: disclose mobile section/topic choices instead of putting the whole catalogue before Continue |
| R3-03 | Coding: one visible local breadcrumb above the mobile description |
| R3-04 | Projects: Premium reflects the target stage, not merely the existence of later paid stages |
| R3-05 | Catalogue: show authored time and difficulty before opening a task |
| R3-06 | Results: readable Input / Expected / Received with all eleven existing results retained |
| R3-07 | Today: use existing lesson names as the primary card title |
| R3-08 | Profile: section anchors while keeping natural card heights and Track → Account ordering |
| R3-09 | FDE: authored total duration and a concrete first activity CTA |
| R3-10 | Quiz: optional direct selection of a previously answered question; existing unanswered navigation stays |

Each underlying issue has one decision. Examples in other project formats or Today states are implementation scope, not additional findings. The accepted workspace, widths, type scale, Quiz pills, stage footer, Account placement and owner exceptions remain baseline. No new Premium/auth/public redesign is included.

## Reproduce

Use Node 24 and the repository's installed dependencies. `node docs/ux-review-round3-2026-11-05/build-fixture.cjs` builds the unchanged application with the bundle budget's public placeholder environment. Serve the client preview on 127.0.0.1:4184, then run `node docs/ux-review-round3-2026-11-05/capture.cjs`. Production guest reads and every in-memory proposal are captured together; account scenes use the checked-in fictional fixture and public payload snapshots. `SCENES=results` repeats a selected scene. These scripts never submit a production quiz or coding solution.

Run `python3 docs/ux-review-round3-2026-11-05/build-review.py` to rebuild the self-contained HTML. Serve the directory on 127.0.0.1:4185 and run `node docs/ux-review-round3-2026-11-05/qa.cjs` for the document checks. `QA.md` records actual results and their limits. Image data are embedded, so the delivered HTML also works offline.
