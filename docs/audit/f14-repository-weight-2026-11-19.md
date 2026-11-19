# F14 Git file-size checkpoint (19 November 2026)

Snapshot 2026-11-19T05:48:14.117317+00:00, checkout `80b259cad07f201569bb241c5b8e4c697adf1da8`. This dated metadata snapshot predates the F3 rebase and final F14 validation. Published history remains intact; no history or preserved checkpoint ref was pruned. Unpublished preparation commit subjects were normalized separately.

## Largest distinct historical paths

The sampled local refs include published history and preserved unpublished/checkpoint backups. Each row is the largest uncompressed blob found for one representative historical path from `git rev-list --objects --all`, not another version of the same path. The path is Git’s representative name, not an exhaustive alias history. Historical maxima are not necessarily on current main. These bytes are not packed `.git` size, clone transfer, deployment context or image size.

At the recorded timestamp there were 17,306 reachable blobs and 3,365 representative blob paths. The earlier saved top30 object list contained 30 versions of the ledger alone; this grouped table avoids repeating that one path.

| Historical representative path | Maximum blob bytes | Blob SHA |
| --- | ---: | --- |
| `docs/audit/devshark-content-ledger.json` | 11,730,065 | `b553c7accb29` |
| `docs/ux-review-round3-2026-11-05/index.html` | 10,882,507 | `093289e65c77` |
| `docs/ux-audit-2026-11-03/index.html` | 10,068,297 | `18ac7baaba13` |
| `docs/ux-review-platform-comments-2026-11-05/index.html` | 8,471,359 | `e066090b60e2` |
| `docs/ux-review-platform-2026-11-05/index.html` | 8,207,181 | `5a174e4623c6` |
| `docs/ux-review-uizze-2026-11-05/index.html` | 3,400,729 | `e4816f01a2aa` |
| `docs/ux-audit-2026-11-03/quiz.html` | 2,003,185 | `e752d3c6bc6e` |
| `docs/ux-audit-2026-11-03/learn.html` | 1,976,863 | `bea35a2a8dd3` |
| `mobile/src/data/offline-data.ts` | 1,753,318 | `0053a55fc28a` |
| `lib/roadmap-questions-extra.cs.ts` | 1,587,665 | `0812eb60c7a6` |
| `triage/scored.json` | 1,400,284 | `60cc9c6d63c2` |
| `docs/audit/wip/inventory/inventory.json` | 1,313,743 | `c5ce5caeab69` |
| `lib/curation-registry.ts` | 1,206,110 | `8221c044da51` |
| `triage/keep_list.json` | 1,146,832 | `f973e6cb5135` |
| `docs/release-acceptance.md` | 1,130,639 | `6958cc8bc737` |

## Largest tracked files at the F14 checkpoint

The `80b259ca` checkpoint has 1,896 tracked blob paths and 52,186,981 bytes summed per tracked path. Excludes untracked files, node_modules and `.git`; this is not filesystem du or deduplicated Git storage.

| Current tracked path | Blob bytes | Blob SHA |
| --- | ---: | --- |
| `docs/audit/devshark-content-ledger.json` | 11,730,061 | `4c1c2c234637` |
| `triage/scored.json` | 1,400,284 | `60cc9c6d63c2` |
| `lib/curation-registry.ts` | 1,206,110 | `ea8065119531` |
| `triage/keep_list.json` | 1,146,832 | `f973e6cb5135` |
| `docs/release-acceptance.md` | 1,121,922 | `93986fced38f` |
| `.claude/skills/ui-ux-pro-max/data/google-fonts.csv` | 743,272 | `73fd6c507d5b` |
| `media/preview.mp4` | 699,986 | `94f9e9efe029` |
| `lib/coding/vendor/quickjs-node24.cjs` | 670,921 | `abf7155a5513` |
| `lib/data/triage-verdicts.json` | 632,561 | `8fc8d5ee80c7` |
| `docs/audit/devshark-content-audit.md` | 598,458 | `34e3484efdf3` |
| `lib/quiz-data.ts` | 596,407 | `b517e4aeafc8` |
| `media/preview.webm` | 525,693 | `174240ddd72d` |
| `scripts/test-launch-contracts.ts` | 495,276 | `678db68e7e53` |
| `lib/coding/solutions/react.ts` | 384,562 | `5ec963316d86` |
| `lib/coding/solutions/evolving.ts` | 354,930 | `58ae6dc81802` |

The protected ledger remains byte-identical to published archive source `0f35d67d`, with Git blob `4c1c2c234637138d77cc0eff781d87c0406f6b72`. The four-byte difference from its historical maximum is not an F14 deletion or compression. The [JSON record](f14-repository-weight-2026-11-19.json) contains full blob IDs and the original evidence digest. Later code and release records add files after this snapshot; F16 owns final batch measurements.

To inspect the same kinds of objects in a later checkout:

```sh
git rev-list --objects --all |
  git cat-file --batch-check='%(objecttype) %(objectsize) %(objectname) %(rest)' |
  rg '^blob ' | sort -k2,2nr | head -30
git ls-tree -r -l HEAD | sort -k4,4nr | head -15
git rev-parse --git-common-dir
git count-objects -vH
```

The first command lists object versions before grouping representative paths, so repeated ledger versions are expected. The object store and its packed size are separate from both tables. The archive shrinks working documentation and deploy inputs while retaining published history and every current ledger/native-review input.
