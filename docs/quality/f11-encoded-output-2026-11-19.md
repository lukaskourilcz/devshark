# F11-16 encoded-output measurement — 19 November 2026

Measured once on clean source `1e3dd005284b0f12ce3b0332b457c3c5ab110641`,
before the output-budget fix. The complete controller run took 66.091 seconds.
This is measured metadata, not a budget implementation or completed F11-16
acceptance. [Structured results](f11-encoded-output-2026-11-19.json) pin the
runtime, tool, program encoder, retained artifacts and maximum identities.

The maximum whole-run encoded packet was **20,455 UTF16 code units** and also
**20,455 UTF8 bytes**, at `js-run-length-encode`, reference, hidden phase,
seven calls. The corresponding displayed-result JSON was 20,126 code units;
that display value was not substituted for the encoded packet measurement.
The canonical 900,000 candidate has 879,545 code units of measured reference
headroom. That arithmetic does not choose or implement the budget; the
existing 1,000,000 host backstop remains unchanged.

Coverage is 586 non-React call-test tasks, 1,702 authored positive variants and
3,404 actual runs: 1,702 visible plus 1,702 fresh hidden runs. Variants include
586 references, 543 junior boards, 543 senior boards, three existing positive
async variants, 16 filled skeletons and 11 known-right cases. The full 814-task
catalogue also includes 183 React suites and 45 non-call grading tasks, which
are explicitly outside this packet encoder. This is not a replay of every
assertion, wrong mutant, browser realm or hidden permutation in `test:coding`.
Hidden calls use the retained reverse-order runChecks seam; using reverse
order for known-right extras is additional stress compared with their original
identity-order helper phase.

The enabled observer independently checked a tagged packet containing
undefined, negative zero, NaN, Infinity, emoji and newline in both visible and
hidden phases. Its UTF16/UTF8 sizes matched that packet and differed from
display JSON. The disabled-observer mutation still graded the public control
successfully but was rejected specifically for missing raw metrics. Synthetic
control rows do not contribute to the reference maximum.

Observation is host-only, immediately after the actual readDriver('output')
and before the existing host guard. The VM program/encoder remained byte
identical in all four virtual source transforms. Actual runChecks, deadlines,
queues, expected-value comparison and public result shapes were retained.
Only counts/identities/source hashes were persisted, never returned values,
source code, calls, expectations or learner error text. Node transport guards
are a functional trusted-reference control, not a hostile-host security sandbox.

All 135 bundled-input snapshots, 19 required source pins and 93 runtime compiler
entry/package/declaration rechecks remained unchanged. The final head and full
tracked/untracked source were clean; all three children exited 0 without a
watchdog/output-limit event, stderr bytes were 0, and private temporary bundles
were removed. Node 24.22.3, esbuild 0.25.12 and TypeScript 5.9.3 with 91 selected
checker libraries are recorded in the JSON metadata.

Complete per-run count-only metadata, source/metafile provenance and both
controls remain on the audit machine under the hash-pinned paths in the JSON.
This compact committed record does not duplicate those 3,404 rows or include
server-only reference source. The output-budget red/fix tests, shared display
changes and integration/CI/merge remain separate work. No new VM, snapshot,
concurrency or grading-budget behavior was selected by this measurement.
