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

## Owner decisions and deferred issue handoff

The owner returned `devshark-ux-review-kolo3-komentare.json`, schema `devshark-platform-ux-review-round3-v1`, exported at `2026-11-05T18:22:31.251Z`, against the same `ca5900282d5e4cc2aa115d5d02585ac056a6d58d` baseline. On 5 November 2026 the owner requested GitHub issues only, with implementation deferred. This section supersedes conflicting proposal text and before/after concepts; the original review remains evidence of what was proposed, not an instruction to implement rejected details.

| ID | Owner decision | Deferred work package | Blocked by |
|---|---|---|---|
| R3-01 | Accept with comment | Fit Daily answers on a short notebook viewport; description at most two lines; remove the entire daily.lead paragraph | None |
| R3-02 | Reject | No mobile Learn disclosure change | Not scheduled |
| R3-03 | Reject original, replace through comment | Mobile Coding displays only the owner's desktop-only informational notice | None |
| R3-04 | Accept | Show project Premium badges for the actual target stage | None |
| R3-05 | Accept | Show authored difficulty and estimated minutes in Coding catalogue rows | None |
| R3-06 | Accept | Present failed Coding tests as Input, Expected and Received | None |
| R3-07 | Accept | Use authored lesson titles in Today plan cards | None |
| R3-08 | Reject | No Profile section-anchor change | Not scheduled |
| R3-09 | Accept | Show FDE module total estimates and name the next activity action | None |
| R3-10 | Accept | Add an optional direct question navigator to Quiz | None |

Seven original proposals were accepted, two rejected without replacement, and one rejected with a replacement request. The resulting eight work packages are independent. Shared Coding files may require coordinating implementation branches; this is not a functional dependency. Dependencies block merges, not commits.

### Comment overrides

- **R3-01:** The owner requests a description of at most two lines and removal of the sentence referred to as “One question a day from a different track, nothing is recorded”. The current `daily.lead` is “One question a day from a different track. No account needed; nothing is recorded.” Remove the whole paragraph in the shared header, including static fallback. Preserve concise category/concept context and never truncate essential question, answer, code or explanation content. The original prototype's separate practice paragraph is superseded.
- **R3-03:** Do not implement the proposed mobile breadcrumb relocation. Instead, mobile Coding shows only this exact owner-provided message: “This section only works in desktop apps. Apologies, but coding on phone is painful and we dont want to cause no harm.” The request replaces the mobile Coding catalogue/editor/puzzle/opt-in flow, including direct Coding challenge routes. Desktop web behavior stays available; this wording does not authorize native/Expo application development. Preserve drafts across layout changes, normal navigation away from the notice, and the ocean/sharks.
- **R3-02 and R3-08:** Rejected with no comment. Do not create implementation issues for the mobile Learn picker or Profile anchors.

### Shared implementation boundaries

Issues are deferred backlog, not implementation performed or authorized now. Preserve the approved logo, Quiz pills/topic logos, ocean/sharks, shared widths/type/control tokens, focus mode and desktop workspace. Keep grading, XP, saved progress, entitlements and unlocks server-authoritative. Do not reopen rejected reading/no-XP notices, Skip to questions, placement-restart copy, End/Cancel confirmations or other earlier owner exceptions. Apply each underlying fix once across its affected instances rather than creating duplicate findings.

The audit's original captures remain proposal evidence. Future implementation must follow the owner overrides and the issue acceptance checks, with meaningful local/dedicated fixtures and no writes to the owner's production learning state.

### Issue numbers (created 5 November 2026)

All eight issues were read back after creation: titles and full bodies match the validated drafts, all remain open, and each carries `design-audit` plus its `P1` or `P2` priority. An open-issue search before creation found no overlapping work package. No issue was created for R3-02 or R3-08; #607 records the replacement requirement, not the rejected R3-03 breadcrumb concept.

| ID | Issue | Blocked by | Status at handoff |
|---|---|---|---|
| R3-01 | [#606](https://github.com/lukaskourilcz/react-express-app/issues/606) | None | Deferred, not implemented |
| R3-03 | [#607](https://github.com/lukaskourilcz/react-express-app/issues/607) | None | Deferred, not implemented |
| R3-04 | [#608](https://github.com/lukaskourilcz/react-express-app/issues/608) | None | Deferred, not implemented |
| R3-05 | [#609](https://github.com/lukaskourilcz/react-express-app/issues/609) | None | Deferred, not implemented |
| R3-06 | [#610](https://github.com/lukaskourilcz/react-express-app/issues/610) | None | Deferred, not implemented |
| R3-07 | [#611](https://github.com/lukaskourilcz/react-express-app/issues/611) | None | Deferred, not implemented |
| R3-09 | [#612](https://github.com/lukaskourilcz/react-express-app/issues/612) | None | Deferred, not implemented |
| R3-10 | [#613](https://github.com/lukaskourilcz/react-express-app/issues/613) | None | Deferred, not implemented |

Each issue includes scope, affected files, blockers, observable acceptance and future verification. Script names, referenced source files and browser suites were checked against the repository. Product/browser checks listed in those issues have not been run as implementation evidence because no product change was made. A planning PR references these issues with `Refs` and must not close them.
