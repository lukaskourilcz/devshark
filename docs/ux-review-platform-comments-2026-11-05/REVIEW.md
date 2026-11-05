# Platform UX review, second round — 5 November 2026

The owner returned 16 commented findings and requested a revised proposal, not product implementation. Exact duplicates and shared patterns are consolidated into 11 review topics. Accepted findings without a comment and the rejected public/Premium proposal are omitted from this round. A comment about a shared pattern applies wherever that pattern occurs, even if the owner did not repeat it on every first-round card.

Before means the previous visual proposal; After means the revision according to the owner's comments. Both are visual concepts, not deployed behavior. The original logo, Quiz topic pills/logos and ocean/sharks stay. Product source and business rules remain unchanged.

The feedback controls use new round-two IDs and a separate storage key. This preserves the first-round feedback and does not silently mark a revised proposal as approved.

Open `index.html` directly, or serve this folder on localhost:4183. The self-contained HTML includes 43 matched pairs across 16 scenes, theme/viewport choices, image zoom, local feedback and validated import/export. Rebuild with `python3 build-review.py`.

## Consolidated decisions

| Revision | Original commented IDs | Decision |
|---|---|---|
| R2-01 | SYS-05, COD-01, QUI-02 | Center code/question blocks; waved coding tabs |
| R2-02 | COD-02, COD-06 | Right-aligned Level row, completed states |
| R2-03 | SYS-03, COD-09 | Centered track intro, 20-row catalogue before Paths |
| R2-04 | COD-08 | Stronger next-challenge wash, no border |
| R2-05 | SYS-02, SYS-04 | Daily topic context instead of generic/future copy |
| R2-06 | LEA-02 | Selected-topic introduction |
| R2-07 | QUI-01 | All categories and shared wider gutters |
| R2-08 | QUI-03 | Centered result summary and three-column review |
| R2-09 | TOD-01 | No root or redundant leaf breadcrumbs |
| R2-10 | PRO-02 | Aligned Profile settings rows |
| R2-11 | PTH-01 | Next activity without a left stripe |

All 16 source IDs occur once. Shared comments apply across related instances; there is no additional card for the same pattern in another section. R2-03 references the common breadcrumb rule, R2-05 references common centering, and all scenes use the shared gutter proposal. These are not duplicate findings.

## Provenance and reproduction

`prototype/previous-proposal.js` is the first report's DOM concept, preserved as the visual baseline. `prototype/revised-proposal.js` layers the owner refinements over it in memory. Neither is imported by the app. Public routes use read-only data; authenticated scenes use the same local fictional account fixture on both sides. The stage progress and six-question result examples are explicitly labelled fiction. `capture-manifest.json` records viewport, geometry, blocked writes and optional fixture reads.

The original logo, Quiz topic logos and ocean/sharks remain. Previously accepted typography, workspace structure and other unmodified work are visual baseline, not new review decisions. No new Uizze calls or product implementation are claimed.

See `QA.md`, `review-qa.json` and `prototype-qa.json`: 25 document checks and six concept/data checks passed. Required repository checks are recorded separately in the pull request; this artifact is not production redesign acceptance.
