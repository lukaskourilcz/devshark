# Epic F baseline index, 19 November 2026

This is the remaining F1 batch for #630, #646 and #629. Its tools and local
measurements are committed on the F1 branch; complete branch parity and
required CI are pending. This index preserves the dates and revisions of
older observations rather than presenting every row as one simultaneous run.

The current runtime reference is merged main
`cbdfa2aa995e7dd71c7d0197fee7f35df21ca205`. New bundle/image measurements use
tool head `d09ec769`; client, API, lib and shared runtime trees equal that
main. Node is 24.22.3. The fresh client build uses `CI=true` and every public
placeholder in `docs/quality/bundle-budget.json` measuredBuild.env. No
credential or real provider is needed for those local builds.

| Measurement category | Actual evidence | Remaining boundary |
| --- | --- | --- |
| Initial graph | [Shaped bundle](f1-bundle-2026-11.json): four initial files, 218,661 gzip bytes / 218,675 cap, no preloaded fonts; matching monitoring 46,800 / 60,000. | New local checkpoint, not a recreated original `a9882348` observation. [Actual production transfer](f1-production-bundle-2026-11-19.json) records five complete bodies, 225,897 encoded bytes including HTML; the earlier partial run remains separate. |
| Largest chunks and treemap | The same artifact retains all ten largest of 233 chunks and hashes of the matching generated treemap/module report, saved with the external execution logs. | Lazy compiler/editor chunks are separate from initial bytes. Per-module gzip estimates do not add up to whole-file gzip. |
| Lighthouse and CDP | [Mobile Lighthouse](f1-mobile-lighthouse-2026-11.json), [desktop Lighthouse](f1-desktop-lighthouse-2026-11.json): 48 completed audits. [Mobile CDP](f1-mobile-cdp-2026-11.json) and [desktop CDP](f1-desktop-cdp-2026-11.json) preserve the original 96 rows plus the separate corrected Daily cohort. | The primary CDP tables use 84 original interaction-valid rows plus 12 corrected Daily rows; the original twelve missing inputs remain visible. Production Home calibration F1-45 is pending. Static Lighthouse and populated CDP states differ. |
| Handler entry and imports | [Complete handler baseline](f1-handler-baseline-2026-11-19.json): actual merged-F7 production 36 read/refusal responses, and two original twelve-handler local import checkpoints with 36 samples each. | Local CJS imports are not deployed Lambda inventory, platform boot, retained memory or authorized learner-operation timing. Slower rows and unknown module markers remain. |
| Images | [Inventory](image-inventory-2026-11.json) and [provenance](image-inventory-provenance-2026-11.json): two byte-identical executions; independent count of 11 source files / 269,577 bytes. Fresh explicit dist has 907 images / 14,602,295 bytes, including 895 generated OG PNGs. | Source-line size hints and lexical references are not rendered size, reachability or deletion authority. Built package attribution remains unknown. |
| Production dependencies | [Exact-lock audit logs](f1-production-audits-2026-11-19.json): both final F7 production-only audits pass with zero vulnerabilities; lock hashes match current main. | Historical logs retain their run window. Host npm version and per-command timestamps in this selected evidence are unknown; future branch gates add separate observations. |
| Database advisors | [Full historical projection](database-advisors-2026-11.json): 90 nested findings in five groups, exact identities/remediation and scoped policy/grant/key crosschecks. | Advisor/catalog/key clocks remain separate. Migration head and function ACLs were not observed. No schema/policy change or planner-performance claim follows. |
| Repository, container and CI | [Exact-main Git weight](repository-weight-2026-11.json): 41,772 reachable objects, 106,650,880-byte stored representation estimate. [F14 container](f1-container-baseline-2026-11-19.json): actual historical paired images. [CI population](f1-ci-quality-snapshot-2026-11-19.json): original 14:19:58 UTC ten-run/76-job selection. | Shared-store du is not main's size or reclaimable bytes. Historical image checkout and CI ref differ and stay explicit. CI's 599 hypothetical ceiling minutes are not billing or a controlled speedup. |

## Request scope and missing historical baseline

[The partial ledger](f1-production-request-ledger-2026-11-19.json) reconciles
154 declared request counts and 161 known completed response observations in
the selected 19 November evidence. F7's 48 attempts and both later raw-transfer runs' eight attempts carry explicit
attempt counters in that selected set. Earlier canonical evidence separately
reports about 290 requests without a raw exact ledger. It is not valid to add
that approximation to exact rows, reset the counter or infer remaining
headroom. Preview63, local loopback and metadata-service queries are separate.

NEEDED.md records the reversible local eight-route choice and the explicitly
authorized small production Home calibration. The earlier no-more-probes
choice inferred an owner gate from contradictory historical under-250 wording;
review of the original brief corrected that interpretation. Raw production
transfer is now recorded after its genuine deadline correction; browser
calibration is still pending collection, not zero. Every new attempt must be counted with its own scope and bounds. The missing original pre-fix
timing cannot be recreated as an observation from its original date or SHA.
These limits remain visible. A new retake of the historical source is being prepared with its actual date and exact dependency versions; it will not be presented as a recovered original observation. Package closeout still requires the remaining measurements, branch parity and required CI.

## Reproduction and provenance

[Tool validation](f1-tool-validation-2026-11.json) preserves actual red/fix
commits, external raw-log hashes, focused/integrated outcomes and the complete
parser-based decoder comparison. `docs/quality/README.md` documents explicit
origin selection, multi-route/sample flags, local fixture states and outputs.
Read each JSON's scope and source pins before comparing rows. An offline
projection of existing observations is not a new benchmark or provider query.

For a new current measurement, retain source/build/tool/lock/browser versions,
all missing or failed rows, request totals and actual route/consent/cache
state. Use the full public build placeholders. A telemetry-key-free build
has a different graph and must be labelled separately. Local browser lab
values, including one scripted interaction per load, are never field INP.
