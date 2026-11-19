# Historical documentation archive

F14 #643 removes completed review exports and old review inputs from the current
docs tree. Their original bytes remain in published main commit
`0f35d67df7e3ae0c2cbd17eb4c44a18c7bf8d83c`:
[browse the original source tree](https://github.com/lukaskourilcz/devshark/tree/0f35d67df7e3ae0c2cbd17eb4c44a18c7bf8d83c).

The [manifest](manifest.json) records all 757 archived paths, their byte counts
and SHA-256 hashes. It also records the unchanged ledger and all 84 native files,
including history and revisions, plus the required surviving tools, Markdown,
templates and brand sources. No Git history was rewritten and no archive binary
was added to the repository. This reduces the working docs tree, not existing
Git history or the size of an already-published Docker image.

| Original directory | Archived files | Original bytes | Pinned source |
| --- | ---: | ---: | --- |
| `docs/ux-audit-2026-11-03` | 4 | 14,870,448 | [HTML exports](https://github.com/lukaskourilcz/devshark/tree/0f35d67df7e3ae0c2cbd17eb4c44a18c7bf8d83c/docs/ux-audit-2026-11-03) |
| `docs/ux-review-platform-2026-11-05` | 84 | 14,285,191 | [HTML and reference media](https://github.com/lukaskourilcz/devshark/tree/0f35d67df7e3ae0c2cbd17eb4c44a18c7bf8d83c/docs/ux-review-platform-2026-11-05) |
| `docs/ux-review-platform-comments-2026-11-05` | 87 | 14,756,597 | [HTML and reference media](https://github.com/lukaskourilcz/devshark/tree/0f35d67df7e3ae0c2cbd17eb4c44a18c7bf8d83c/docs/ux-review-platform-comments-2026-11-05) |
| `docs/ux-review-round3-2026-11-05` | 67 | 18,904,496 | [HTML and reference media](https://github.com/lukaskourilcz/devshark/tree/0f35d67df7e3ae0c2cbd17eb4c44a18c7bf8d83c/docs/ux-review-round3-2026-11-05) |
| `docs/ux-review-uizze-2026-11-05` | 2 | 3,456,235 | [HTML exports](https://github.com/lukaskourilcz/devshark/tree/0f35d67df7e3ae0c2cbd17eb4c44a18c7bf8d83c/docs/ux-review-uizze-2026-11-05) |
| `docs/audit/wip` | 513 | 24,621,579 | [Completed non-native inputs](https://github.com/lukaskourilcz/devshark/tree/0f35d67df7e3ae0c2cbd17eb4c44a18c7bf8d83c/docs/audit/wip) |
| Total | 757 | 90,894,546 | |

## Restore historical files

Run from the repository root with Node and the original commit available in
local Git history. The command reads that commit without checking it out or
changing the current branch. If a shallow clone lacks the commit, retrieve the
published main history before restoring.

```sh
archive_dir=$(mktemp -d)
node scripts/restore-docs-archive.mjs --output "$archive_dir"
```

The command verifies the original blob sizes and hashes before writing any
files. It restores the 757 paths beneath the empty destination, for example
`$archive_dir/docs/ux-audit-2026-11-03/index.html`. It refuses a nonempty
destination and never overwrites current review inputs. Open the restored HTML
locally to inspect its original interactive export and reference files.

To inspect one source file without restoring the collection:

```sh
git show 0f35d67df7e3ae0c2cbd17eb4c44a18c7bf8d83c:docs/ux-audit-2026-11-03/coding.html > /tmp/devshark-coding-review.html
```

## Historical tool reruns

The current tree retains the tool code and briefs. Completed inputs include
final/review/verify data and 15 JSON candidate inventories under
`docs/audit/wip/tools`; restore those inputs before a historical rerun. Do not
run a retained tool against missing inputs or treat an old review as a new
content decision. The current ledger and native review bindings remain the
authoritative inputs for current catalogue checks.

For a complete historical rerun, extract the whole original snapshot into a
separate empty directory so the tools see their matching catalogue, ledger,
native records and data. Review the historical tool before running it; the
archive restore command itself executes no archived code.

```sh
snapshot_dir=$(mktemp -d)
git archive --format=tar 0f35d67df7e3ae0c2cbd17eb4c44a18c7bf8d83c | tar -xf - -C "$snapshot_dir"
```

## Verify the F14 preservation snapshot

```sh
node scripts/test-docs-archive.mjs
node scripts/restore-docs-archive.mjs --verify
```

The fixture and navigation tests need no network or historical Git checkout.
`--verify` additionally audits the current ledger/native bytes and required
paths against the F14 preservation snapshot. It is a dated preservation check,
not a permanent ban on later approved review changes. Historical restoration
still verifies the original source bytes and works after a later ledger update
without replacing that newer ledger. Future review work retains its normal
content-review and binding contracts.
