# F11 binding inventory: observed display-transport test failure

19 November 2026. The clean 23a874f2 final-fast attempt was stopped with SIGINT
at 6 minutes: complete:false, 21 pass, 1 fail, 1 skip, 1 not-run. Launch passed 117 s
(80 result lines); path authority and React authority also passed. This remains
an incomplete failed checkpoint, not final acceptance.

The actual full grading-integrity command failed after 17 s. Its live realm
inventory returns the complete global/member tuple, but the test attempted
JSON.parse on results[0].actual, a displayed string subject to the intended
2,000-character cut. Parsing stopped at position 2013 with Unterminated string.
This is a test-oracle transport defect; it does not justify increasing the
production display budget or changing the pinned allowlists.

Static review finds one complete-payload parser of displayed actual: the
inventory at scripts/test-grading-integrity.ts:1557. The other displayed-value
consumers compare/print formatting, or classify an initial JSON-kind prefix;
unrelated Maps/mocks also use the name actual. The search receipt contains 37
hits across scripts/lib/shared/client/packages, with multiline/alias review
kept distinct from this direct-sink count.

The correction will compare the same complete global/member tuple with the
pinned CHECKER_GLOBALS/CHECKER_MEMBERS through production expectations, whose
full-value comparison precedes display cutting. It must retain exact names,
own properties, prototypes and TypedArray keys. Actual VM extra-global and
late-member add/delete negatives must fail that same full oracle; late changes
must remain detectable even with identical truncated displays. Keep the whole
subsequent host-function/ref/module-loader and wasm import/export inventory.

This record commits the observed red before that correction. Raw failure and
summary hashes, consumer search and plan are retained at
/tmp/devshark-epic-f-handoff/f11-binding-inventory-correction-23a874f2/actual-red.json.
Focused correction, full integrity umbrella, types and the next clean-head
fast remain pending. The earlier dbfde6ad unused-export failure remains a
separate historical checkpoint.

## Correction verified (20 November local, 19 November UTC)

Test-only fix `9d5660a0` passes the unchanged complete inventory as the actual
grader expectation and checks its full-value pass before display cutting.
Guards require codeError:null, timedOut:false, one result and error:null, so a
failed setup cannot satisfy a negative. Actual VM controls add a global
function, add a late prototype member and delete Math.hypot. All three mismatch
the same full expected tuple; the last two retain exactly the baseline cut
display, proving late keys still matter. A fresh inventory then passes.

The inventory-call body remains byte-identical (SHA 818e2216…), as does the
entire subsequent host-function/ref/module-loader and wasm inventory block
(SHA 6d63fbff…). The latter still pins one grader/three React host functions,
20 wasm imports and 75 exports separately from the public global/member tuple.
No production source, pinned registry, display 2000, encoded 900000, v3 session
tag or resource/pool policy changed. Alias/multiline review found no other
full displayed-value decoder; jsonKind deliberately reads a preserved prefix.

Focused real-worker controls pass 0.378 s. The complete test:grading-integrity
umbrella passes 163.631 s: 183 printed PASS groups plus 27 transform cases with
zero failures, including the registered resource and local guest checks. The
credentialed VM part explicitly skips with the snapshot blank. Scripts types
pass 9.578 s. These actual receipts keep the original b1c5d95b head/test-only
dirty state, subsequently committed byte-identically at 9d5660a0. They are not
relabelled as a clean final-fast run.

The adjacent JSON pins every receipt, full red, source reversal and consumer
review scope. A new clean-head fast and one additional same-head Launch remain
pending, followed by required CI/merge and scoped deployment acceptance. The
old 23a Launch is retained as historical evidence, not its replacement.
