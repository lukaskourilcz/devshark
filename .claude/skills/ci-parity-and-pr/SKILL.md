---
name: ci-parity-and-pr
description: Reproduce the `verify` CI job locally with `npm run ci:parity`, then merge through a pull request with `verify` and `sql` green, delete the branch and record the release. Use before any push to a branch that will be merged, and to write the PR body and the `docs/release-acceptance.md` entry.
---

# CI parity and pull requests

`main` is protected: GitHub merges a pull request only when the `verify` and `sql` jobs of `.github/workflows/quality.yml` pass, for admins too, and refuses force-pushes (CLAUDE.md, "Git workflow"). The `verify` gates run 55 steps as five parallel jobs of at most 30 minutes each, and the job named `verify` passes only when all five passed. A step you skip locally can cost a whole CI cycle: PR #401 passed a short local check list and then failed `check:bundle` by 182 gzip bytes ("15 October — PR #401 initial-load correction" in `docs/release-acceptance.md`).

`scripts/ci-parity.mjs` runs the same steps in the same order with the same environment and prints each step's real result. Before it runs anything it reads `quality.yml` and checks two things: the job's `npm` and `npx playwright` commands, in order and with their env prefixes, must equal the plan's, and every other line of the job (setup, `env:`, `if:`, shell glue) must equal `KNOWN_GLUE` in the script. On any difference it exits 2 and prints the first one. Change `PLAN` or `KNOWN_GLUE` and the table below in the same commit as the workflow.

## The `verify` sequence

The commands come from `.github/workflows/quality.yml`, where the gates run as five parallel jobs: `quickjs` (steps 1-2), `static` (3-13), `tests` and `coding` (14-26), and `browser` (27-55). The job named `verify` needs all five and fails when any of them failed, was cancelled or was skipped; it is the required check. `ci:parity` runs the jobs one after another in this order, and counts a command an earlier job already ran (`npm ci`, the browser job's build) once. Step ids are in the second column.

| # | Step id | Command | Notes |
|---|---|---|---|
| 1 | `install` | `npm ci --no-audit && npm ci --no-audit --prefix client` | Runs locally when `node_modules` or `client/node_modules` is missing, or with `--install`. Install-time advisory reports are redundant; the explicit production audit steps remain required. |
| 2 | `check:quickjs-build` | `npm run check:quickjs-build` | CI skips it when `lib/coding/vendor`, `lib/coding/quickjs-variant.ts`, `scripts/rebuild-quickjs-sort.mjs`, `package.json`, `package-lock.json` and `client/package-lock.json` match the PR base; the script compares the working tree with `git merge-base HEAD origin/main` the same way. Any `package.json` edit, a new npm script included, triggers it. The rebuild needs Python 3.10+ (`SHARK_PYTHON`) to install the pinned emsdk, or an emsdk in `SHARK_EMSDK_DIR`; without either the step is reported as not run, and CI's result is the evidence. |
| 3-5 | `typecheck:api`, `typecheck:scripts`, `typecheck:tooling` | `npm run typecheck:api && npm run typecheck:scripts && npm run typecheck:tooling --prefix client` | `typecheck:tooling` lives in `client/package.json`. |
| 6 | `audit:native-reviews` | `npm run audit:native-reviews` | |
| 7-8 | `check:unused`, `check:security` | `npm run check:unused && npm run check:security` | |
| 9-11 | `build`, `check:public`, `check:bundle` | `npm run build && npm run check:public && npm run check:bundle` | Build env below. The `browser` job builds again with the same env and tests that build. |
| 12-13 | `audit:prod`, `audit:client` | `npm audit --omit=dev && npm audit --omit=dev --prefix client` | |
| 14-26 | `test:performance` to `test:coding` | `test:performance`, `test:launch`, `test:coding-auth`, `test:grading-integrity`, `test:path-authority`, `test:react-authority`, `test:paths`, `test:billing`, `test:fallbacks`, `test:garden`, `test:live-grading`, `test:client`, then `test:coding` | The `tests` job chains the first twelve, and the first failure stops the rest; the `coding` job runs `test:coding` alone. `test:coding` runs every task's reference and takes several minutes. |
| 27 | `chromium` | `npx playwright install --with-deps chromium` | Locally `npx playwright install chromium` (idempotent), unless `CHROME_BIN` or `/opt/pw-browsers/chromium` exists. |
| 28 | `preview` | `npm run preview --prefix client -- --host 0.0.0.0 --port 4173` | Started in the background and polled like `scripts/wait-for-preview.mjs`. |
| 29-48 | `browser:<spec>` | `npm run test:browser -- tests/browser/<spec>.spec.ts` | 20 runs in workflow order, from `public` to `launch-offer`; `guide-startup`, `profile-leaderboard-preferences` and `profile-path-picker` share one run (`browser:guide-startup+profile-leaderboard-preferences+profile-path-picker`), and so do `learning-release` and `learn-sections` (`browser:learning-release+learn-sections`), the FDE path specs `fde-hub`, `fde-taster`, `fde-positioning` and `interview-shelf` (`browser:fde-hub+fde-taster+fde-positioning+interview-shelf`), and `path-content-shapes`, `portfolio-export`, `diagnostic-overview` and `dsa-advanced` (`browser:path-content-shapes+portfolio-export+diagnostic-overview+dsa-advanced`). |
| 49 | `check:responsive` | `npm run check:responsive -- --routes /,/quiz,/topics/javascript-closures,/daily,/not-found-responsive-check --widths 360,390,430,768,1024,1280,1440` | `TOPIC` comes from the workflow. |
| 50 | `check:responsive:dark` | `RESPONSIVE_THEME=dark npm run check:responsive -- --routes /,/topics/javascript-closures,/daily --widths 390,768,1280` | |
| 51 | `test:harness` | `npm run test:harness` | Needs the client build and Chromium. |
| 52-55 | `audit:performance`, `build:storybook`, `storybook`, `browser:storybook` | `npm run audit:performance`, `npm run build:storybook`, `npm run storybook --prefix client -- --ci` on port 6006, then `STORYBOOK_URL=http://localhost:6006 npm run test:browser -- tests/browser/storybook.spec.ts` | CI runs this step whenever the build step passed, even after a browser failure. |

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
npm run ci:parity -- --fast               # steps 1-28 and 49-50
npm run ci:parity                         # the whole verify job
npm run ci:parity -- --only test:launch,build --log-dir artifacts/ci-parity-only
npm run ci:parity -- --fast --bail        # stop at the first failure, as CI does
npm run ci:parity -- --sql                # add the sql job (DATABASE_URL set)
```

**When to run which.** CI is the gate; a local run is how you avoid a wasted CI cycle (owner, 21 October 2026: speed matters, so do not repeat the whole job locally by habit). Before every push, run the steps your diff touches with `--only` (types, the suites for the area, `build` and `check:bundle` when client code changed, the browser spec you added or changed on a spare port). Run `--fast` when the diff crosses areas (shared types, `package.json`, scripts other suites import), and the full job when it reworks client routes or the shell. Other files point here for this rule; do not restate it elsewhere.

`--fast` skips the 20 browser runs, `test:harness` and the Storybook and performance step. It still builds, starts the preview and runs both `check:responsive` sweeps. `--only` runs the named steps and records the run as `partial`; give it its own `--log-dir` so it does not replace the summary of a full or fast run.

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
