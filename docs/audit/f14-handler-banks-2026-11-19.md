# F14-09 handler bank measurement

Measured 19 November 2026 at `6fe446e6e01fb05930a3db6dcb03e60e56a86c11`.
This records a proposal, not a shipped runtime optimization. No bank, curation
record or Docker/Vercel build configuration changed.

The paired builds use the actual `docker/build-handlers.mjs` settings: twelve
handlers, bundled Node 24-targeted CommonJS, external packages, no minification,
splitting or source maps. The measurement adds metafiles and writes outputs to
an external directory. Both builds reuse the same captured source contents;
the [JSON report](f14-handler-banks-2026-11-19.json) records versions, source
hashes and the snapshot fingerprint. The corrected builds took 0.292 and
0.191 seconds. Those build times establish no cold-start or request-time gain.

## Actual bundled bytes

| Handler | Current CJS bytes | Prototype CJS bytes | Saved bytes | Reduction |
| --- | ---: | ---: | ---: | ---: |
| `admin/[op]` | 6,096,966 | 5,507,594 | 589,372 | 9.67% |
| `flashcards` | 4,072,002 | 3,482,630 | 589,372 | 14.47% |
| `health` | 38,343 | 38,343 | 0 | 0% |
| `leaderboard` | 59,807 | 59,807 | 0 | 0% |
| `play/[action]` | 4,115,775 | 3,526,403 | 589,372 | 14.32% |
| `quiz/challenge` | 5,422,152 | 4,832,780 | 589,372 | 10.87% |
| `quiz/daily` | 4,096,158 | 3,506,786 | 589,372 | 14.39% |
| `quiz/questions` | 10,165,642 | 9,576,270 | 589,372 | 5.80% |
| `quiz/roadmap` | 13,177,625 | 12,588,253 | 589,372 | 4.47% |
| `quiz/submit` | 4,103,560 | 3,514,188 | 589,372 | 14.36% |
| `settings` | 1,362,469 | 1,362,469 | 0 | 0% |
| `user/[op]` | 10,445,097 | 10,445,097 | 0 | 0% |
| Sum of twelve outputs | 63,155,596 | 58,440,620 | 4,714,976 | 7.47% |

Five handlers exceed the issue's 10% proposal threshold. The aggregate does
not. The sum counts duplicated modules in independent handler bundles; it is
neither an image-size measurement nor a Vercel trace/deployment measurement.

## Filter and preservation boundary

`quiz-data.ts` already selects `category === 'code-snippets'` from its private
`coreQuestions` array before assembling the exported question bank. The
prototype applies that same selection to the authored literal array during
the build: it keeps 55 of 850 literals and omits 795 that the existing runtime
assembly never returns. It changes no source bank in the repository.

An isolated pure-module evaluation confirms deep equality of all 2,607 raw
question objects, their order, IDs and answer fields. Content hashes, version
input tuples and results from the current eligibility policy also match.
The bank keeps 2,453 eligible questions, including 319 in categories retired
from delivery; 2,134 remain deliverable. It also preserves all 154 withheld
raw history questions. Coding source inputs and the curation registry remain
unchanged. No handler, database, network request or grader ran in this probe.

Filtering the exported bank by current curation eligibility would remove
those 154 history questions. `questions-store.ts` deliberately keeps them for
history, admin review and overrides. That broader filter is invalid and was
not built or proposed.

The old standalone `roadmap-questions-html.ts` and
`roadmap-questions-css.ts` are absent from the actual handler input graph and
contribute zero bytes. Deleting them cannot produce this bundle saving.
The cool-stuff source still contributes 37,819 bytes to each of eight data
handlers; the unused aggregate initializer still remains in those outputs.
Testing and abbreviations contribute 44,390 and 35,169 bytes per affected
handler and remain raw/history bank inputs. Source names and source-file
lengths do not establish safe removal.

## Proposal and reproduction

Consider only a build-time form of the existing private core-array filter,
based on the five measured gains above. Preserve the source banks, complete
raw history/admin/override behavior, IDs, versions, eligibility, public payload
and grading contracts. Before shipping a transform, add focused regressions
for those boundaries and run the normal required gates. This measurement
does not apply the prototype to Docker or Vercel.

From the repository root with its installed dependencies:

```sh
output_dir=$(mktemp -d)
node scripts/measure-handler-banks.mjs --out "$output_dir"
```

The tool requires an empty directory outside the repository. It saves the
current and prototype CJS outputs, per-handler/global metafiles, source-input
hashes and `comparison.json` there. It asserts that the prototype actually
loaded and that esbuild received the transformed source byte count, then
checks the full raw-bank and static eligibility equality.

An initial local attempt used `/tmp` without resolving its `/private/tmp`
alias, so its transform did not run. That attempt is historical and excluded
from these results. The corrected tool canonicalizes both source and output
paths and checks transform application. Full runtime grading, production
latency, image size and the complete F14 release remain unverified here.
