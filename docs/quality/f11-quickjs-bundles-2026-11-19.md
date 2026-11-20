# F11-20/32: normal QuickJS bundle measurements

19 November 2026. Local test commit `b95ef7f8`, fix `c55ba3c4`; no merge or
remote acceptance is claimed. The adjacent JSON retains every worker sample,
source/output hashes, exact tool versions and the focused results.

The actual guest retained unused default SDK variants. The worker already
removed that registry, so it is a positive control. Both artifacts retained
the full 819,611-byte inactive singlefile wasm literal. After adding that
independent hash-pinned check, the real normal build produced three failing
and three passing checks before the test commit. The shared build helper
then kept the real core/loader/custom payload and removed the unused code.

| Actual emitted artifact | Before raw | After raw | Before gzip | After gzip |
| --- | ---: | ---: | ---: | ---: |
| React guest | 2,057,914 | 887,329 | 674,932 | 346,595 |
| QuickJS worker | 1,680,590 | 876,631 | 603,988 | 344,641 |

Gzip uses the same Python/zlib build, level 9 and mtime 0. The passive 67-byte
sidecar matches the final guest. The source/data-only custom wasm, ABI,
lockfile and runtime policies remain unchanged. The normal metadata retains
21 guest and 16 worker inputs; actual missing/zero/default/external mutations
and alias/strip bypass controls reject broken graphs. A real custom-hook
engine passes; removing the hook refuses the stripped empty fallback.

Five serial fresh Node 24 processes per stage used the real runInSandbox API,
a correct fixed next(1) call, and one reused worker for the next call. Cold
median fell from 71.170 to 58.677 ms; warm median moved from 8.305 to 8.801 ms.
The timer starts after host module imports and includes actual worker startup,
SDK initialization and the first grade. Each sample used one worker and two
successful grades. These ordered local samples do not eliminate OS-cache/order
noise or establish a universal speedup/p95. RSS in the JSON is whole-process,
not VM heap or a provider memory requirement.

Focused green results: six output checks; 27 transform/metadata/bypass/hook
controls; 37 actual worker sort cases plus pinned payload provenance; nine
local guest groups plus seven artifact/cache/inclusion groups; and eight
shared-build pack/restore controls. The guest test explicitly cleared the
snapshot and skipped credentialed VM acceptance. Existing 19 integrity and 22
fetch/data/authored controls pass against the newly emitted guest.

The full composed grading/reference/Coding, types, launch/parity, provider,
CI/Preview and merge checks remain pending. The original 16 full-reference tool
builds its own virtual untrimmed worker; its prior result does not establish
coverage for this trimmed normal builder. Preserve that distinction in the
final gate. Raw commands, graph metadata and receipts remain under
`/tmp/devshark-epic-f-handoff/f11-remaining-execution-3fa8f8ed/20-32/`, with
standalone baseline/candidate captures and sample JSONs pinned by the adjacent
measurement JSON.
