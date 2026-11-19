---
name: ci-parity-and-pr
description: Reproduce the `verify` CI job locally with `npm run ci:parity`, then merge through a pull request with `verify` and `sql` green, delete the branch and record the release. Use before any push to a branch that will be merged, and to write the PR body and the `docs/release-acceptance.md` entry.
---

# CI parity and pull requests

`main` is protected: GitHub merges a pull request only when the `verify` and `sql` jobs of `.github/workflows/quality.yml` pass, for admins too, and refuses force-pushes (CLAUDE.md, "Git workflow"). The `verify` gates run 44 steps across seven jobs of at most 30 minutes each, and the job named `verify` passes only when all seven passed. A step you skip locally can cost a whole CI cycle: PR #401 passed a short local check list and then failed `check:bundle` by 182 gzip bytes ("15 October — PR #401 initial-load correction" in `docs/release-acceptance.md`).

`scripts/ci-parity.mjs` runs the same steps in the same order with the same environment and prints each step's real result. Before it runs anything it reads `quality.yml` and checks two things: the job's `npm` and `npx playwright` commands, in order and with their env prefixes, must equal the plan's, and every other line of the job (setup, `env:`, `if:`, shell glue) must equal `KNOWN_GLUE` in the script. On any difference it exits 2 and prints the first one. Change `PLAN` or `KNOWN_GLUE` and the table below in the same commit as the workflow.

## The `verify` sequence

The commands come from `.github/workflows/quality.yml`. `client-build` produces one artifact with the complete client and generated runner outputs. `static` and `browser` depend on that producer and verify its commit and SHA-256 inventory before using it. The local runner builds and packs once instead of downloading its own artifact. `verify` requires all seven non-SQL jobs and rejects skipped or cancelled jobs.

| # | Step id | Command | Notes |
|---|---|---|---|
| 1 | `install` | `npm ci --no-audit && npm ci --no-audit --prefix client` | Runs when dependencies are missing or with `--install`. |
| 2 | `check:quickjs-build` | `npm run check:quickjs-build` | Changed runtime/package inputs trigger the pinned rebuild. Local Python 3.10+/emsdk is required; an unavailable rebuild is not a pass. |
| 3-4 | `build`, `check:ci-build-artifact` | `npm run build && npm run check:ci-build-artifact` | The placeholder environment below matches CI. The tar preserves hidden Vite manifests, source maps, sandbox output and generated runner files. |
| 5-7 | Types | `typecheck:api`, `typecheck:scripts`, client `typecheck:tooling` | |
| 8-13 | Native and static guards | `audit:native-reviews`, `check:unused`, `check:security`, `check:docs-archive`, `check:deploy-contexts`, `check:binary-size` | The binary gate compares against the fetched event base. |
| 14-18 | Build guards and production audits | `check:images`, `check:public`, `check:bundle`, `npm audit --omit=dev`, client production audit | |
| 19-31 | Contract, client and coding suites | `test:performance`, `test:launch`, `test:coding-auth`, `test:grading-integrity`, `test:path-authority`, `test:react-authority`, `test:paths`, `test:billing`, `test:fallbacks`, `test:garden`, `test:live-grading`, `test:client`, `test:coding` | Keep the coding timing guard unchanged. |
| 32-33 | Chromium and preview | `npx playwright install --with-deps chromium`, client preview on 4173 | CI caches browser files by OS, architecture and the installed browser revision file. It still installs system dependencies. Local installed Chrome can replace the download. |
| 34 | `browser:chromium` | `npm run test:browser -- --project=chromium --workers=2 <explicit specs>` | The 33 previous specs plus `triage-private` share one invocation. Files may run concurrently; tests within each file retain their order. `BROWSER_SPECS` records the exact selection. |
| 35-38 | Responsive | Light 20 routes by 9 widths, dark 20 by 3, synthetic 200% and 400% Home reflow | Matrices and strict fixture/target contracts remain intact. |
| 39 | `test:harness` | `npm run test:harness` | |
| 40-43 | Performance and Storybook | `audit:performance`, `build:storybook`, Storybook server, `browser:storybook` | CI runs these when the shared build restored successfully, including after another browser failure. |
| 44 | `test:container` | `npm run test:container` | Full mode only. CI compares baseline/candidate image bytes and one current reference harness against each image's dependencies and generated workers on one Linux/amd64 runner. Docker is required; the Mac does not start a VM for this step. |

The `sql` job runs separately: `npm run test:sql` on `supabase/postgres:17.6.1.171` (`scripts/test-sql.mjs`).

### Environment

- **Node 24.** CI uses Node 24; `package.json` accepts 22 to 24. The script warns on any other major version. On a machine with a newer Node, install `node@24` from npm into a scratch folder and put its `bin` first on `PATH`.
- **`CI=true`**, as GitHub Actions sets it.
- **Build env** for `build`, `check:public` and `check:bundle`: `VITE_PRODUCT=devshark`, `VITE_LOCK_SUBJECT=webdev`, and `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from `measuredBuild.env` in `docs/quality/bundle-budget.json`. `check:bundle` measures against that placeholder project, and `tests/browser/lazy-auth.spec.ts` signs in through it.
- **`CHROME_BIN`.** CI exports Playwright's Chromium path just before `check:responsive`, so the browser specs launch Playwright's own browser and `check:responsive`, `test:harness` and the steps after them get `CHROME_BIN`. The script does the same. In the Claude Code cloud sandbox it uses `/opt/pw-browsers/chromium`; an explicit `CHROME_BIN` wins everywhere.
- **Ports** 4173 (preview) and, in a full run, 6006 (Storybook) must be free. The script exits 2 before step 1 when either already answers, because an old server would serve an old build. Never start two runs at once.
- **`DATABASE_URL`** for the `sql` job only. It must point at an empty Postgres; `scripts/test-sql.mjs` refuses a database that already has tables in `public`, and it needs a local `psql` client:

  ```sh
  docker run -d --name devshark-sql -p 54339:5432 -e POSTGRES_PASSWORD=postgres supabase/postgres:17.6.1.171
  until docker exec devshark-sql pg_isready -U postgres -h 127.0.0.1; do sleep 2; done
  DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54339/postgres npm run ci:parity -- --sql --only test:sql --log-dir artifacts/ci-parity-sql
  docker rm -f devshark-sql
  ```

  Start a Docker VM on the owner's machine only with their approval. Without one, the CI `sql` job is the evidence: say so and do not report `test:sql` as run. `supabase/tests/known-failures.txt` may only shrink.

## Running it

```sh
npm run ci:parity -- --list               # the plan, nothing runs
npm run ci:parity -- --fast               # steps 1-33 and 35-38
npm run ci:parity                         # the whole verify job
npm run ci:parity -- --only test:launch,build --log-dir artifacts/ci-parity-only
npm run ci:parity -- --fast --bail        # stop at the first failure, as CI does
npm run ci:parity -- --sql                # add the sql job (DATABASE_URL set)
```

**When to run which.** CI is the gate; a local run is how you avoid a wasted CI cycle (owner, 21 October 2026: speed matters, so do not repeat the whole job locally by habit). Before every push, run the steps your diff touches with `--only` (types, the suites for the area, `build` and `check:bundle` when client code changed, the browser spec you added or changed on a spare port). Run `--fast` when the diff crosses areas (shared types, `package.json`, scripts other suites import), and the full job when it reworks client routes or the shell. Other files point here for this rule; do not restate it elsewhere.

`--fast` skips the combined browser run, `test:harness` and the Storybook and performance step. It still builds, starts the preview and runs the light/dark `check:responsive` sweeps and both zoom profiles. `--only` runs the named steps and records the run as `partial`; give it its own `--log-dir` so it does not replace the summary of a full or fast run.

Without `--bail` the script keeps going after a failure and marks the steps that need a failed step as not run (the browser steps need `build`, `preview` and `chromium`). Each step writes a log, and the run writes `summary.json` in the log directory (`artifacts/ci-parity/` by default, git-ignored). The summary holds `mode` (`fast`, `full` or `partial`), `only`, `complete`, `stopped` (a signal, `bail` or a crash), `head`, `dirty`, `node`, `startedAt`, `minutes`, the counts, and each step with its `result` (`pass`, `fail`, `skipped` or `not-run`), `detail` and `log` path. The script deletes the old summary when it starts and writes the new one even when it stops early. Exit code 0 means a complete run with no failure.

The script tests the working tree, but CI sees only committed files, so commit before the run you quote. Quote a summary as evidence only when `complete` is true, `dirty` is false and `head` equals `git rev-parse HEAD`. A skipped or not-run step is neither passing nor failing: name it and give its reason.

## Branch, commits and pull request

1. **One branch per issue**, from a fresh `main`: `git switch main && git pull --ff-only && git switch -c claude/<issue-id>-<slug>`, for example `claude/a1-learn-sections-registry`. Do not stack a branch on another unmerged branch. When a blocker merges, rebase: `git fetch origin && git rebase origin/main`, then `git push --force-with-lease` (your feature branch only; `main` refuses force-pushes).
2. **Small, coherent commits** that name the issue (`feat(learn): add the section registry (#487)`). End each message with the `Co-Authored-By:` trailer the session's instructions give. Prose follows `.claude/skills/stop-slop`.
3. **Run the local checks the rule above asks for** on the committed head, plus anything the issue's verification plan names.
4. **Push and open the pull request** with `gh pr create --base main --head <branch> --title "<issue title>" --body-file <file>`. The body:

   ```markdown
   <One paragraph: what changes for a learner or a maintainer, and what does not.>

   ## Changes
   - <file or area>: <what and why>

   ## Validation
   Local, Node <version>, `npm run ci:parity -- --fast` at <short sha>: <N> passed, <N> skipped (<reasons>), <N> not run (<reasons>).
   Issue checks: <command>: <real result with counts>.
   Not run: <check> (<why>).

   ## Notes
   <Where the issue and the code disagree, say which line and that the issue was updated. Owner items added to NEEDED.md.>

   Closes #<issue>

   🤖 Generated with [Claude Code](https://claude.com/claude-code)
   ```

   End the body with the attribution line the session's instructions give. A planning or documentation PR that only references implementation issues uses `Refs #N`, never `Closes`.
5. **Migrations first.** When the diff adds a file under `supabase/`, the migration goes to production before the code merges (`docs/launch-runbook.md`, "Database rollout"; `.claude/skills/supabase-migration/SKILL.md`). Merge only after the migration is applied, by the owner or by an agent the owner authorised for that task, and record it in `NEEDED.md` as an `[owner:me] [kind:deploy]` item until then.
6. **Wait for the required checks**: `gh pr checks <pr> --watch --required`. Run it in the background and move on. When a check fails, read its log with `gh run view <run-id> --log-failed`, fix the cause on the branch, push, and wait again. Never merge around a red check.
7. **Recheck a moved `main`.** Branch protection does not require an up-to-date branch, so CI tested your branch merged with the `main` of the moment it ran. If `main` has since gained changes your diff depends on (shared types, loaders, scripts, contracts), rebase, rerun the affected checks, push with `--force-with-lease` and wait for CI again. PR #527 passed CI and would have broken `typecheck:scripts` on `main` after #526 changed `loadSubjectQuestionBank`.
8. **Merge** with a merge commit and delete the remote branch: `gh pr merge <pr> --merge --delete-branch`. The repository merges with merge commits ("Merge pull request #518 from …").
9. **Clean up locally**: `git switch main && git pull --ff-only && git branch -d <branch>`, and `git worktree remove <path>` for a worktree you created. Leave no stale branch behind.

## After the merge

Vercel deploys `main` to production. For a change that alters production behaviour:

1. Find the production deployment of the merge SHA and wait until it is READY (Vercel MCP `list_deployments` and `get_deployment`, or `gh api repos/lukaskourilcz/devshark/commits/<sha>/status`).
2. Run the smoke checks the change needs from `docs/launch-runbook.md` ("Preview smoke test", "Release and observation") against devshark.app, read-only and as a guest unless the owner approved a fixture. Create no accounts, scores, orders or messages on production without approval.
3. Write the acceptance entry (below) and the `NEEDED.md` updates. The merge has already happened, so commit them on the next issue's branch, or on a short `claude/<issue-id>-acceptance` branch with its own pull request when no next branch exists.

## The `docs/release-acceptance.md` entry

New entries go at the end of the file, as "B14 FDE release verification — 22 October 2026" does; the oldest entries near the top run newest first. Append yours at the end:

```markdown
## <What shipped> — <D Month YYYY>

Issue #<n>: <what changed, in behaviour terms, and what stayed the same:
handlers, rewards, access, schema>.

<Local evidence with counts: the ci:parity mode and head, which suites, how
many tests or files, the bundle figure against its budget, both audits with
their vulnerability count, the responsive matrix actually run.>

PR #<n> is merged at <merge sha>. Frozen head <head sha> passes required run
<run id>: verify <m>m<s>s, SQL <s>s. READY production <dpl_…> matches the merge
SHA and serves devshark.app; <which smoke checks passed against it>.

<Non-claims: what this evidence does not establish, for example authenticated
production acceptance, physical devices, independent review or production
data. Anything still open and where it is tracked.>
```

An entry for local, unmerged evidence (as "15 October — local structuredClone own-key correction (#403)" is) leaves out the PR, run and deployment paragraph and says the issue stays open until a checked merge. Write each figure from a run you made in this session. When a step could not run, say which and why. Record a failed run before the passing one, with what fixed it, as the PR #401 entries do.

## Validation of this skill

`npm run ci:parity -- --list` exits 0 only while the plan matches `quality.yml`. `npm run ci:parity -- --fast` on a clean checkout installs, runs and reports each step.

The `webkit` project also covers `first-load`, `navigation`, `coding-workbench`, `mobile-safari` and `consent-reflow` at the configured iPhone profile. Run it with `npx playwright test --project=webkit tests/browser/first-load.spec.ts tests/browser/navigation.spec.ts tests/browser/coding-workbench.spec.ts tests/browser/mobile-safari.spec.ts tests/browser/consent-reflow.spec.ts` after installing WebKit. The Chromium CI commands select their project explicitly so a local WebKit project does not change CI engine coverage. Record the measured WebKit time and physical-device limits in release acceptance.

The responsive command first runs its matrix, account-fixture and effective target contracts, then its existing browser cleanup tests. The light sweep measures 20 routes at nine widths; the dark sweep measures the same routes at 390, 820 and 1280. Account pages use invented local session/data fixtures. Two zoom sweeps verify reflow geometry, including 320 CSS pixels at 400 percent.
