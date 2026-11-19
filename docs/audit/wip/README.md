# Content audit (#176) — work in progress

F14 #643 archived the completed non-native JSON/JSONL data, including 15
historical candidate inventories under `tools/`. The tool code, briefs,
current ledger and entire native subtree remain in this checkout. The paths
below describe the historical workflow. Follow the [archive restoration
instructions](../../archive/README.md) before a historical rerun; missing
inputs do not authorize a new review result.

Interim artifacts of the devShark content audit (#176). The question audit
finished and merged on 2026-09-11; `docs/audit/devshark-content-audit.md` is
the report and `docs/audit/devshark-content-ledger.json` the record. Nothing
here is quoted by the product. The coding catalogue was audited too, and #176
closed on 2026-10-17. The tools and briefs stay for future reviews.

- `REVIEWER-BRIEF.md`, `CODING-BRIEF.md` — the rubric and the output schema
  the item-level reviewers apply (the issue's rubric, verbatim in substance)
  and the coding-task variant that requires the real grader.
- `inventory/inventory.json` — the reconciled inventory: every question a
  learner can be served (2,128 active, 319 in retired sections), 312
  unreferenced, 795 legacy, 249 coding tasks, with plain content hashes.
- `inventory/batch-*.json` — the reviewer inputs, one per topic batch
  (English item + automated flags), fifty items
  for the first-wave topics, sixty or fewer elsewhere.
- `context/` — the per-batch level titles, plan membership and instructions.
- `coding/` — the coding-task batches with their server-only solutions and
  hidden tests. Never copy anything from here into learner-visible copy.
- `review/` — item-level review fragments: `review-css.json` (complete, array
  format) and `review-<topic>-<n>.jsonl` (one JSON object per line, appended
  as the reviewer went; a partial file is resumed after its last id, never
  rewritten). Each row carries the seven quality dimensions, the five
  relevance markers, both gate outcomes, the decision and evidence; rows
  written before 21 October 2026 also carry a translation verdict from the
  retired second-language check. These are the rows the ledger
  (`docs/audit/devshark-content-ledger.json`) is built from once a topic's
  batches are all in.
- `tools/` — the scripts that turn the fragments into content changes and
  ledger rows (`apply-rewrites.ts`, `build-ledger.ts`, `grade-task.ts`,
  `export-coding.ts`, `seed-locator.ts`) and the Python helpers that validate
  reviews, enrich batches, build contexts and summarise the ledger. The
  handoff shows how to bundle them.

State when this snapshot was taken (2026-09-10, before the second readings
landed): the gate is live. 848 items are in the
ledger, CSS, JavaScript and TypeScript are enforced as complete categories,
and 84 items are retired and 1 quarantined across five topics. Every one of
the 2,128 served questions has a first-pass review; eleven topics are waiting
on their second reading before their rewrites can be applied.
The handoff for the next steps (`docs/audit/HANDOFF-176-w2.md`) was deleted
on 2026-10-22 once #176 had closed; Git history keeps it.

Directories added since the first snapshot:

- `verify/` — the second reading. One JSON Lines row per rewrite: the verdict
  (accept, amend or reject), the fields it changed, the problems it found and
  the evidence it ran. A reject becomes a quarantine, so nothing rewritten
  reaches a learner on one reading.
- `final/` — the merged rows, the review folded together with its second
  reading. This is what the applier and the ledger builder read; the
  fragments in `review/` and `verify/` are never edited in place.
