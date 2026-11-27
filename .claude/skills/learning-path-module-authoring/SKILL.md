---
name: learning-path-module-authoring
description: Author or revise one FDE learning-path module with its solution file, its native review records and its inventory counts. Use for any change under lib/learning-paths/content/fde/ or lib/learning-paths/solutions/.
---

# Learning-Path Module Authoring

A module reaches a learner only when the path validator finds no error in the whole path, every reference solution passes its own hidden assertions in the real sandbox, and the path switch is on (`readinessFor` and `availabilityFor` in `lib/learning-paths/catalog.ts`; `LEARNING_PATH_FDE_ENABLED` in `pathEnabledInEnv`). One broken module takes the whole path offline, because `validatePath` judges the path, not the module (`lib/learning-paths/validate.ts` header: "A path with any `error` cannot be published"). This skill takes one module from an empty file to a passing `npm run test:paths` with current review records. Premium rules live in [../learn-question-authoring/references/premium-gating.md](../learn-question-authoring/references/premium-gating.md).

## Read first

`lib/learning-paths/types.ts` (every source shape), `lib/learning-paths/validate.ts` (every error code), `shared/learning-paths.ts` (`activityIdPrefix`, `MODULE_SHELVES`, `isOffLoopModule`, `pathInventory`, `SATISFYING_STATES`), the header and `KNOWN_WRONG_PATH` in `scripts/test-learning-paths.ts`, `scripts/learning-path-schema-contracts.ts`, `scripts/audit-native-reviews.ts`, and `docs/fde-curriculum.md` (the module table, the assessment design and the content-quality rules). Then read `lib/learning-paths/content/fde.ts`, the module file you will change or the one before it in the loop, and its solution file.

## English only, one file per module

- devShark ships English only, for good (CLAUDE.md, "Protected behavior"). Every copy field in `lib/learning-paths/types.ts` is a plain `string`, the authored English source is the only copy (`types.ts` header), and `validate.ts` has no translation check. Write no overlay file, no `lang` field and no second copy of any string.
- Path copy comes from the server's manifest, not from `client/src/i18n/`. A module needs no client change: `ActivityViews` already renders `scenario` and `fixtureNote`. Interface strings for paths live in the route-local `client/src/i18n/translations.paths.ts`; add a key there only when the screen itself changes.

## Where a module lives

| What | Where | Rule and source |
|---|---|---|
| Module body | `lib/learning-paths/content/fde/<file>.ts`, exporting `FDE_<NAME>: ModuleSource` | One file per module (`lib/learning-paths/content/fde.ts` header). Start with a header comment: what the module teaches, its shape (lessons, checks, practical), and which companies, records and model outputs are fixtures written for it (`content/fde/m01.ts` header). |
| Answer material | `lib/learning-paths/solutions/fde-<file>.ts`, exporting `FDE_<NAME>_SOLUTIONS: Record<string, PathCodeSolution>` | Reference solution and hidden assertions per code activity id. A module without code exports `{}` so `solutions/index.ts` spreads every module alike (`solutions/fde-m01.ts` header). The catalogue never imports this directory, and nothing under `client/` may import `lib/learning-paths` (`scripts/test-learning-paths.ts`, "the answer material stays server-side"). |
| Registration | `modules` in `FDE_PATH` (`lib/learning-paths/content/fde.ts`) and `ALL` in `lib/learning-paths/solutions/index.ts` | Manifest order is loop order. The first loop module is where `nextActivityId` sends a new learner (`shared/learning-paths.ts`), and the free tier opens it ("Tiers" below). Shelf modules go after every loop module (`shelf_before_loop` warning in `validate.ts`). |
| A new competency | `competencies` in `FDE_PATH` | Every id an activity names must exist (`unknown_competency` error). A competency no activity teaches raises `uncovered_competency` (`validate.ts`). The existing `integration-data` competency in `FDE_PATH` shows the shape. |

Ids:

- Every activity id starts with `activityIdPrefix('fde', 1)`, which is `fde-v1-` (`shared/learning-paths.ts`; `id_prefix` error). Use lowercase dashed slugs of 3 to 96 characters for module, lesson, activity and question ids, and keep them unique across the path. This is an authoring convention: `validate.ts` checks module/activity slug shapes, lesson duplication across modules and question duplication within each check, but does not enforce every cross-kind collision. Inspect new ids against the full manifest before shipping.
- Follow the existing pattern for a new module: module `fde-v1-m14`, lessons `fde-v1-m14-l1` and `-l2`, lesson activities `fde-v1-m14-l1-read`, the check `fde-v1-m14-checks`, questions `fde-v1-m14-q1` and on, the practical a descriptive slug.
- Curriculum v1 is edited in place: the manifest keeps `version: 1` and ids keep `fde-v1-`. Module files, constants and module ids follow the current M01 to M14 numbering, but lesson, activity, question and solution keys keep the slug they were authored under, so recorded evidence is never renamed: `fde-v1-m08-untrusted-content` lives in module `fde-v1-m10` (`docs/fde-curriculum.md`, "Content quality and upkeep"). Never rename an existing id.

## The module shape

`ModuleSource` in `lib/learning-paths/types.ts`: `id`, `title`, `outcomes`, `competencies`, `dependsOn`, `lessons`, `activities`, `requires`, `estimatedMinutes`, and the optional `optional` and `shelf`. A loop module keeps the v1 shape: two lessons with sources, one scenario check, one practical activity and its requirements. `outcomes` must not be empty (`no_outcomes`), and every learner-visible string and list entry must have copy (`missing_copy` in `validate.ts`, `pathCopyFields` and `pathCopyLists`).

### Lessons

- `LessonSource`: `id`, `title`, `summary`, `estimatedMinutes`, `sources`, `sections` (`types.ts`). At least one section (`empty_lesson`) and at least one source (`no_sources`).
- Section kinds (`LessonSectionSource` in `types.ts`): `prose`, `code` (language, code, caption), `table` (caption, headers, rows), `trace` (caption, frames of `cells`, optional `marks`, a `note` and an optional `counter`; shapes `array`, `stack`, `queue`, `tree`, `counter` from `TraceSpec` in `shared/learning-path-api.ts`; at least one frame, or `empty_trace`), `example` (a runnable snippet with a `caption` and a `note` that says nothing is graded; a blank one is `missing_copy`), and `callout` (tone `note` or `warning`).
- Each source is `{ label, url, reviewedOn }` (`SourceReference` in `shared/learning-paths.ts`): an `https` URL (`bad_source_url`) and an ISO date (`bad_review_date`) on which you checked the claim you cite.
- A lesson activity (`kind: 'lesson'`) names a lesson of its own module in `lessonId` (`unknown_lesson`) and is `self_reviewed` (`lesson_verification`). Lessons never gate completion; `test:paths` checks that the next action sends a new learner through the lessons before the first requirement ("the next action teaches before it checks").

### The four activity kinds

Every `ActivitySource` carries `kind` (`lesson`, `check`, `code`, `artifact`), `purpose` (`diagnostic`, `exercise`, `project`) and `verification` (`machine_verified`, `self_reviewed`) (`shared/learning-paths.ts`), plus `title`, `summary`, `competencies` and `estimatedMinutes` between 1 and 480 (`bad_estimate`).

| Kind | Verification | What the validator demands (`validate.ts`, `validateActivity`) |
|---|---|---|
| `lesson` | `self_reviewed` | `lessonId` of a lesson in this module |
| `check` | `machine_verified` | At least one question; `passThreshold` a finite number in (0, 1], 0.8 in every FDE check; per question at least three distinct options, `correct` an integer index of one of them, known competencies. A `domains` list makes every question name one of its domains and every domain hold a question |
| `code` | `machine_verified` | A body (`code`) or a `reuseTaskId`, never both; a non-empty starter, at least one hint, visible `tests` (or a `suite` for React), unique criterion ids, at least one critical criterion, positive finite weights (`bad_weight`), and tests that name declared criteria |
| `artifact` | `self_reviewed` | A `brief`, at least one field, unique field ids, `maxLength` an integer from 1 to 8,000, rubric dimensions that exist in `FDE_PATH.rubric` |

Purpose: `exercise` for module work. `project` is a capstone or final: a failed project check withholds its key and explanations until a pass (`keyWithheld` in `lib/learning-paths/grade.ts`). `diagnostic` is placement and can never be required (`diagnostic_required`); the path's diagnostic must be a `check` (`diagnostic_not_check`), because the competency report is built from its questions.

The server shuffles a check's options for every attempt (`shuffleWithOrder` in `lib/learning-paths/handlers.ts`), so `correct: 0` on every question, as `content/fde/m01.ts` writes them, leaks nothing.

### Scenario, fixture note and shelf

- `scenario` (check only; `misplaced_scenario` elsewhere): a shared preamble shown once above the ordered questions, for a decomposition case. It needs at least three questions (`scenario_too_few_questions`), warns past 2,000 characters because every catalogue response carries it (`long_scenario`), and must never quote a question id, a correct option or an explanation of 30 characters or more (`scenarioLeaks` in `scripts/learning-path-schema-contracts.ts`, run over the published paths by `test:paths`).
- `fixtureNote` (code only; `misplaced_fixture_note` elsewhere): shown above the editor for the learning and re-engineering drills. It says the fixture is deliberately unfamiliar and what "done" means. It sits at activity level, so a `reuseTaskId` activity can carry one (`ActivitySource` doc comment in `types.ts`).
- `shelf: 'interview-prep'` (module; `MODULE_SHELVES` in `shared/learning-paths.ts`): lists the module apart from the loop. A shelf module must also set `optional: true` (`shelf_not_optional`), carries no requirements (`optional_requirements`), and no loop module may depend on it (`loop_depends_on_shelf`). Its checks, code and artifacts stay out of every inventory count (`pathInventory`).
- An empty string in any of them is a `missing_copy` error: the merge keeps an authored empty string so the validator sees it (`mergeActivity` in `types.ts`).

## Requirements and the acyclic rule

- `requires` lists `{ activityId, state }` pairs, each naming an activity of this module (`unknown_requirement`). A loop module needs at least one (`no_requirements`); an optional or shelf module has none (`optional_requirements`).
- Require `verified_pass` only of a machine-verified activity (`unverifiable_requirement`); require `self_reviewed` of an artifact, which a verified pass also satisfies (`SATISFYING_STATES` in `shared/learning-paths.ts`). Never require `needs_revision` or `not_started` (`impossible_requirement`).
- `dependsOn` names modules of the path (`unknown_dependency`), and the dependency graph must stay acyclic (`findCycle` in `validate.ts`; `dependency_cycle` prints the loop). The capstone `fde-v1-c01` lists every required module in its `dependsOn` (`content/fde/c01.ts`), because the capstone needs every required module; a new loop module joins that list.
- `test:paths` checks that the requirement lists the submit handler sends to the database agree with `moduleComplete` for every module ("the database completes a module by moduleComplete's rule"; migration 054).

## Code activities

- Language `javascript`, `typescript` or `react` (`PathCodeLanguage`). The graders are the coding section's: QuickJS, the TypeScript checker and the React runner, with no Python, SQL or shell execution. SQL and Python stay graded reading inside checks.
- The solution file holds `solution` and at least one of `hiddenTests` or `hiddenTypeTests`; `test:paths` fails a code activity without hidden assertions ("needs hidden assertions") and runs the reference through `gradePathCode` in the real sandbox ("every reference solution passes its own assertions").
- **Criteria grouping.** Unmarked assertions join the default critical criterion `core` (`DEFAULT_CRITERION` and `mergeCode` in `types.ts`). A pass needs every critical criterion and 80 % of the weighted non-critical ones (`DEFAULT_CRITERION_THRESHOLD` in `grade.ts`). Put every security-critical behaviour (tenant isolation, injected instructions, replay, signature checks) under its own criterion with `critical: true`, so a failure there cannot be averaged away by a strong score elsewhere. `fde-v1-m08-untrusted-content` in `content/fde/m10.ts` separates `core`, `no-injected-action`, `no-cross-tenant` and `allowlisted-recipient`, all critical. Give each criterion a `detail` that explains the failure without the implementation, and at least one assertion, visible or hidden (`test:paths`: "criterion … has no assertion").
- **Flawed variants.** Add the activity to `KNOWN_WRONG_PATH` in `scripts/test-learning-paths.ts`: each entry is the reference with one mistake put back in (`replace: [from, to]`, where `from` must occur in the reference text) and the criterion that must catch it. `test:paths` grades each variant and fails while the named criterion still passes, and fails an entry whose `from` text no longer occurs ("the known mistake … no longer applies"). Name the mistakes the issue lists and the shortcuts a learner would try first; the `fde-v1-m05-data-reconcile` entry is the model.
- **A reused coding task** (`reuseTaskId`) carries no body and no second reference (`reuse_and_body`; `test:paths`: "must not carry a second reference solution"), and needs an entry in `KNOWN_WRONG_REUSED` that the task's own hidden assertions refuse.
- A `harness` is appended after the learner's code to hand them counted accessors; state the allowed operations in `contract`, or the validator warns (`harness_without_contract`). Only trusted catalogue text goes into a harness (`lib/learning-paths/harness.ts` header).
- A starter may end in a `// Scratch pad` block of example calls; `test:paths` then grades the reference with that block appended, so the examples must run.
- Limits: submitted code 20 KiB, a draft or artifact 64 KiB, 60 drafts per enrollment (`PATH_LIMITS` in `shared/learning-path-api.ts`). `test:paths` fails when the path's code exercises plus artifacts exceed the draft cap.

## Artifacts

An artifact lists its required fields, each field's cap and the rubric dimensions before the learner starts. Field kinds are `short-text`, `long-text`, `list` and `url` (`ArtifactFieldSource`). The grader records a submission as `self_reviewed` after checking presence and length, and a required field is a critical criterion (`grade.ts`). Say in the brief and the field help that a length check cannot judge quality, as `fde-v1-m01-scope-brief` does. Rubric dimension ids: `problem-framing`, `technical-correctness`, `integration-data-quality`, `evaluation`, `security`, `operability`, `communication` (`FDE_PATH.rubric`).

## Review dates and versioning

- `FDE_PATH.reviewedOn` must be an ISO date (`bad_review_date`). Past 400 days `validatePath` warns `stale_review` (`MAX_REVIEW_AGE_DAYS`); a warning does not fail `test:paths`, so check it yourself. A change to the path's content moves `reviewedOn` to its authoring date.
- Every lesson source carries its own `reviewedOn`; the validator checks its format, not its age.

## The content quality contract

Each line names the rule or check behind it:

- Every lesson names its sources with `reviewedOn`.
- Checks use plausible options of comparable specificity and length (`test:paths` fails a key above 1.15 times the distractors' mean length or 5 % over the longest distractor; tighten the key or give a distractor the reasoning a real engineer would use, never pad it), explain why each alternative fails in this case, and pass at 80 % with retry and explanation (`passThreshold: 0.8`).
- Code activities carry a passing reference, flawed variants that must fail, and criteria grouped so a security-critical failure cannot be averaged away (`test:paths`, `test:path-authority`, and `test:harness` when a grader changes).
- Artifacts list their fields, caps and rubric dimensions before the learner starts.
- English copy passes `.claude/skills/stop-slop` and the `product-copy-reviewer` agent's review. No AI feature, no AI claim, no certification, hiring or salary claim: completion reads "FDE guided path completed" (`completionLabel`) and the path's `nonGoals` say what it is not (CLAUDE.md, "Protected behavior" and "Brand").
- Every model response, retrieval result, tool trace, company, person and record is a fixture written for the module, and the module says so where a learner might assume a live system (`content/fde.ts` header). No live model, vendor account or paid API. Use reserved `.example` domains for email addresses, as `content/fde/m10.ts` and `content/fde/bridges.ts` do.
- Write no ASCII-quoted `"xp"` anywhere in copy: `test:launch` asserts the manifest never names XP (`/"xp"/i`, "a learning path awards no XP in v1").

## Tiers

`shared/tiers.ts` is the only place that decides what a learner may start (CLAUDE.md). Enrolling is free; `contentTier` opens the `learning-path-activity` items of the first loop module by manifest order and of the module that holds the diagnostic, and makes every other activity Premium. Put no tier flag in a module file. Moving a module to the front of the loop changes what a free account opens; say so in the pull request.

## Inventory counts

Every count the product shows comes from `pathInventory(publicManifest(path))` (`shared/learning-paths.ts`), so a screen cannot advertise content before it exists. After a change, update each place that states a count in the same commit:

| Count | Where | Enforced by |
|---|---|---|
| Minimum lessons, module checks, code exercises per path | `TARGETS` in `scripts/test-learning-paths.ts` (FDE: 20, 40, 10) | `test:paths` fails below the target. Raise the target when the curriculum commits to more; never lower it to make a removal pass. |
| Code exercises plus artifacts against the draft cap | `PATH_LIMITS.draftsPerEnrollment` | `test:paths` |
| Interactive lesson examples | section 4 of `docs/interactive-content-manifest.md` (the `example` sections table and its "Gaps" paragraph: four of the eighteen original DSA readings, FDE none) | The document says every count in it is test-enforced, but no script counts `example` sections today (`grep -rn "'example'" scripts` finds none). Adding or removing an `example` section in an FDE lesson means editing that table and the gap paragraph by hand in the same commit. |
| The module table and the inventory sentence | `docs/fde-curriculum.md`, "Modules and deliverables" (the table) and "Inventory and numbering" (the sentence) | Read-back. Edit the module's row when its lessons, practical or dependencies change, and the sentence when the counts change. |
| The counts the path header and Profile show | `pathInventory` | `scripts/learning-path-schema-contracts.ts` keeps shelf and optional modules out of them |

`npm run content:snapshot` prints the live counts (`.claude/skills/shark-learning-content-map/SKILL.md`); quote it, not memory. `test:paths` prints the same line at the end (`fde v1: <n> modules, <n> lessons, …`).

## Native review records

`scripts/audit-native-reviews.ts` (CI step `audit:native-reviews`) binds an individual review record to each lesson, activity and check question of the published path (FDE; the retired DSA path's records are archived under `docs/audit/wip/native/history/`) by exact hash. Records live one JSON object per line in `docs/audit/wip/native/review-<date>-<batch>.jsonl`.

- **What a record binds.** `contentHash` is `nativeContentHash` of the merged item, and an activity with code or a `reuseTaskId` also carries `gradingHash` from `nativeGradingHash`, which covers the activity, its tests and its solution (`lib/learning-paths/audit.ts`). An activity's hash includes its questions, so editing one question's explanation stales the question's record and its check's record. Editing a hidden test or the reference stales the activity's `gradingHash`.
- **What fails.** A record whose hash no longer matches fails CI ("Stale native content review" or "Stale native grading review"), as do a duplicate key, an unknown item, a wrong `kind`, a `qualityScore` that is not the minimum of the scored dimensions, a `relevanceScore` that is not the sum of the five markers, a null dimension without a `notApplicable` rationale, a reviewer kind other than `model` or `human`, and an empty `verification.notes`. An item with no record passes the script, which prints "N still require individual review"; the product rule is still that new items get records.
- **A changed item** needs a fresh individual review that replaces the stale record in place, on the same line of the same file. Before replacing, copy the old record into `docs/audit/wip/native/history/review-<date>-<batch>-before.json` (a JSON array of the replaced records). The new record carries the new `contentHash` (and `gradingHash`), `previousHash` set to the old `contentHash`, `previousGradingHash` when the grading hash moved, a new `reviewedAt`, scores and rationale written from a fresh reading, and `verification`. Add `docs/audit/wip/native/revisions/continuation-<date>-<batch>.json` with `kind`, `reviewedIds`, `uniqueCoverageAdded`, `currentReviewFiles`, `history` and `note`. Use the existing records under `docs/audit/wip/native/` and a continuation under `revisions/` as the field model; choose a record for the same item kind.
- **A new item** gets a new record in the batch's new `.jsonl` file. Copy the field set of an existing record: `id`, `kind` (`native-lesson`, `native-activity`, `native-check-question`), `path`, `module`, `locale: "en"`, `source`, `contentHash`, `gradingHash`, `hashSchema`, `objective`, `intendedLevel`, the seven `quality` dimensions (1 to 5, or null with a `notApplicable` reason), `qualityScore`, the five `relevance` markers (0 to 2) with `relevanceRationale`, `relevanceScore`, `gates`, `decision`, `correctnessBlocker`, `rationale`, `evidence`, `reviewedAt`, `reviewer` and `verification`.
- **Never rebind mechanically.** Copying the new hash into an old record without rereading the item is the failure this audit exists to stop ("Validate recorded item reviews, never manufacture scores from execution", line 1 of the script). Record a model review as `reviewer.kind: "model"` with `independent: false` unless a separate reviewer read it, and never as a person (`docs/curation-claims.md`).
- **Finding every stale or missing record.** The script stops at the first stale record. List them all against the inventory:

  ```sh
  npm run audit:devshark-inventory -- --out "$TMPDIR/inv"
  jq -r '.pathMaterials[] | "\(.id) \(.contentHash) \(.gradingHash // "null")"' "$TMPDIR/inv/inventory.json" | sort > "$TMPDIR/current.txt"
  cat docs/audit/wip/native/*.jsonl | jq -r '"\(.path):\(.id) \(.contentHash) \(.gradingHash // "null")"' | sort > "$TMPDIR/recorded.txt"
  comm -23 "$TMPDIR/current.txt" "$TMPDIR/recorded.txt"   # items without a record at their current hashes
  comm -13 "$TMPDIR/current.txt" "$TMPDIR/recorded.txt"   # records that are stale or name a removed item
  ```

  The inventory's `kind` reads `lesson`, `activity` and `check-question`; the record's `kind` adds the `native-` prefix.

## Procedure

1. Read the issue and the module's row in `docs/fde-curriculum.md`. Note every module and id the change touches.
2. Write or edit the module file. For a new module, create the solution file (`{}` without code), register both, and add the module to the capstone's `dependsOn` when it is a required loop module.
3. Iterate on shape: `PATHS_ONLY=fde PATHS_SKIP_RUN=1 npm run test:paths`. Both flags are local aids, never set in CI (`scripts/test-learning-paths.ts` header); `PATHS_ONLY` also skips the orphan-solution check. When the path has a validator error, the handler contracts at the end of the run can crash with a `TypeError` before the failure list prints. Read the validator's own list instead:

   ```sh
   echo "import { LEARNING_PATHS, readinessFor } from './lib/learning-paths/catalog'; for (const p of LEARNING_PATHS) for (const i of readinessFor(p).issues) console.log(i.level, i.code, i.at, i.message);" \
     | npx esbuild --bundle --platform=node --format=esm --packages=external --sourcefile=issues.ts --loader=ts --log-level=warning \
     > node_modules/.cache/shark/path-issues.mjs && node node_modules/.cache/shark/path-issues.mjs
   ```

4. Write the reference, hidden assertions, criteria and `KNOWN_WRONG_PATH` entries; run `PATHS_ONLY=fde npm run test:paths` until every reference passes and every flawed variant fails.
5. Update the counts in the table above and `docs/fde-curriculum.md`.
6. Run the stop-slop pass over every string you wrote, then the `product-copy-reviewer` agent.
7. Write the native review records (new items) and replacements (changed items), then confirm both `comm` lists are empty and `npm run audit:native-reviews` passes.
8. Run the validation block without `PATHS_ONLY` or `PATHS_SKIP_RUN`.

## Temporary dry run

A workflow check may use a reduced one-lesson, one-check module. Teach every concept its questions assess and keep the options comparably specific. Run `npm run test:paths`, then remove the sample files, manifest and solution registrations, review records and any temporary dependency/count edits. Search for the sample id and confirm it is absent from the final diff before opening the PR. The sample never ships as required path content.

## Validation

```sh
npm run test:paths
npm run test:path-authority
npm run audit:native-reviews
npm run test:launch
npm run typecheck:api
npm run typecheck:scripts
git diff --check
```

| Command | What it proves |
|---|---|
| `test:paths` | No validator error in either path; inventory at or above `TARGETS`; draft cap; database requirements agree with `moduleComplete`; no answer, explanation, hidden assertion or reference in the public manifest; checks grade against the sealed key only; every reference passes visible and hidden assertions in the sandbox; every `KNOWN_WRONG_PATH` and `KNOWN_WRONG_REUSED` variant fails; no orphan solution; the schema contracts and the handler contracts |
| `test:path-authority` | The probes still refuse forged counters and replaced globals, graded through `gradePathCodeWith` against the private fixtures in `scripts/fixtures/path-authority-fixtures.ts` (copied from the retired DSA path) and through `gradePathCode` on a published FDE exercise (`scripts/test-path-authority.ts`); run it when a harness or grader changes |
| `audit:native-reviews` | Every record binds to its item's current hashes with well-formed scores |
| `test:launch` | FDE stays the only published path, the retired DSA id names nothing, the manifest carries no key, harness, explanation or XP, and a check never passes without its sealed key |
| `typecheck:api`, `typecheck:scripts` | The module, solution and test-script edits type-check |
| `git diff --check` | No whitespace errors |

Add `npm run test:harness` (needs a client build and `CHROME_BIN`) for React activities or grader changes. Before pushing, follow `.claude/skills/ci-parity-and-pr/SKILL.md`. Report each command's real result and the inventory line `test:paths` printed. A module counts as authored only when `test:paths` passes without the local flags and both `comm` lists are empty.
