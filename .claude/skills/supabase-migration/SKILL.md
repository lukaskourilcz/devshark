---
name: supabase-migration
description: Author, test and record a numbered schema migration. Use for any change under `supabase/`.
---

# Supabase Migration

A schema change ships as one new numbered file, one SQL behaviour test, a deploy item in `NEEDED.md` and a line in the product architecture. Production gets the file before the code that needs it merges. Each rule below names the file it comes from.

## 1. Pick the number

1. List `supabase/supabase-schema-*.sql` and take the highest number plus one, padded to three digits. After 066 the next file is `supabase/supabase-schema-067.sql`. Source: `scripts/test-sql.mjs`, step 3, which stops with "Migrations must be numbered 002, 003, … without gaps or duplicates".
2. Fetch `origin/main` before you commit and look again. When another branch merged the same number first, renumber your file while nobody has applied it. Source: the same check in `scripts/test-sql.mjs`.
3. Never edit a file production has applied, including to make a check pass; write a forward migration. Source: `.claude/commands/release-validate.md`, step 6. `docs/product-architecture.md`, "Compatibility and rollback", adds that rolling code back leaves applied migrations in place. `scripts/test-launch-contracts.ts` also reads old files by name (`erasureContracts`, `monthlyXpContracts`), so an edit to an applied file changes what the contracts prove.

## 2. Write the file

Copy the shape of `supabase/supabase-schema-065.sql` and the headers of 059 and 060:

```sql
-- Migration NNN: <what it adds, in one sentence>. Apply after migration <MMM>.
-- Safe to re-run; the whole file is one transaction. Compatible with the code
-- in production (<short sha>): <which routines that code calls keep their
-- name, arguments, body and grants>.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF to_regprocedure('public.<routine it builds on>(<arg types>)') IS NULL THEN
    RAISE EXCEPTION 'migration NNN needs migration MMM first';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.<table> (...);
ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.<table> FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.<routine>(<args>)
RETURNS <type> LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  ...
END;
$$;
REVOKE ALL ON FUNCTION public.<routine>(<arg types>) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.<routine>(<arg types>) TO service_role;
COMMENT ON FUNCTION public.<routine>(<arg types>) IS 'Called by <actual caller path or database object>.';
COMMIT;
```

- The header says what the file adds, what it needs and why the running code survives it. Sources: the headers of `supabase/supabase-schema-059.sql` and `supabase/supabase-schema-060.sql`; `docs/launch-runbook.md`, "Database rollout", step 9 ("Each file's header says what it adds, what it needs and why the running code survives it").
- `BEGIN;` and `COMMIT;` wrap the whole file. Source: `supabase/supabase-schema-065.sql`.
- A `DO` guard refuses to run before the objects the file builds on exist. Source: `supabase/supabase-schema-060.sql`, the block that raises "migration 060 needs migrations 056 and 058 first".
- Every statement survives a second run: `IF NOT EXISTS` on tables, columns and indexes, `CREATE OR REPLACE` on routines, `DROP POLICY IF EXISTS` before `CREATE POLICY`. Sources: `supabase/supabase-schema-065.sql` (`ADD COLUMN IF NOT EXISTS`), `supabase/supabase-schema-063.sql` (`CREATE TABLE IF NOT EXISTS`), `supabase/supabase-schema-018.sql`, line 23 (`DROP POLICY IF EXISTS` before its `CREATE POLICY`); `docs/release-acceptance.md`, "Migration 045 proof" (the "then 045 again" row), which proves a re-run leaves the catalog fingerprint unchanged.
- Every table has row level security on. Every `SECURITY DEFINER` routine sets a fixed `search_path` without `$user` or `pg_temp`, `anon` and `authenticated` cannot execute it, and `service_role` can. Source: `supabase/tests/010-schema-security.test.sql`, which fails the suite otherwise and checks only these four things; `supabase/supabase-schema-063.sql`, lines 20 to 23, shows the statements.
- Pin that `search_path` to an empty string, written `SET search_path = ''` with spaces. 010 also accepts `search_path = public`, but the launch contracts match the empty spelling for every routine they pin, and AGENTS.md asks for service-role isolation. Sources: `scripts/test-launch-contracts.ts`, `erasureContracts`, `merchContracts` and `voucherContracts` (`/SECURITY DEFINER\s+SET search_path = ''/`); `AGENTS.md` ("Keep Supabase/RLS/service-role isolation").
- Give the browser roles no grant or policy on a table beyond an owner-only read the product needs. Sources: `supabase/tests/158-rls-own-rows-only.test.sql`, whose header requires every policy for `anon`, `authenticated` or `public` to read the caller's own rows only; `docs/launch-runbook.md`, "Database rollout", step 8 (no `SELECT` policy or grant for `authenticated` on `learning_path_attempts`).
- A new table with an account column (`user_id`, `invitee_user_id`, `referrer_user_id`) must lose the account's rows when `delete_user_data` runs, and needs a seeded row in `supabase/tests/080-delete-user-data.test.sql`, which finds such tables from the catalog. The routine can erase the table itself, or the table can reference one it erases with `ON DELETE CASCADE`: 063 does the second, since `shark_name_allocations.user_id` references `user_handles(user_id) ON DELETE CASCADE` and `delete_user_data` deletes from `user_handles`. Sources: the header of `supabase/tests/080-delete-user-data.test.sql`; `supabase/supabase-schema-063.sql`, line 16; `supabase/supabase-schema-060.sql`, `delete_user_data` (`DELETE FROM public.user_handles`); `docs/product-architecture.md`, "Account erasure".
- `npm run test:launch` checks erasure only up to the newest file that restates `delete_user_data`. `erasureContracts` takes that file as `latest` and checks each table with an account column created by a file after 033 and before `latest` (`one > 'supabase-schema-033.sql' && one < latest`). Each must appear as `public.<table>` in the body and as `'<table>'` in the guard before the routine. A table created after `latest` passes unchecked, which is why 063 passes today. A dry run on 21 October 2026 copied the 060 guard and `delete_user_data` unchanged into a scratch file after 065, and `npm run test:launch` failed with "supabase-schema-063.sql created shark_name_allocations with an account column and delete_user_data does not erase it". Source: `scripts/test-launch-contracts.ts`, `erasureContracts`.
- So the next restatement of `delete_user_data` brings 063 into range. Its body must name `public.shark_name_allocations`, and its guard must list `'shark_name_allocations'` next to every table the guard of 060 lists. Copy that guard (`supabase/supabase-schema-060.sql`, the `DO` block before `delete_user_data`) and keep these two lines word for word, with your number in place of 060:

  ```sql
  IF to_regclass('public.' || v_table) IS NULL THEN
  RAISE EXCEPTION 'migration NNN needs 035 and 039 to 045 first; missing: %', array_to_string(v_missing, ', ');
  ```

  The contract matches them with `/IF to_regclass\('public\.' \|\| v_table\) IS NULL THEN/` and `RAISE EXCEPTION 'migration NNN needs 035 and 039 to 04\d first; missing: %'`. The general guard wording in the template above ("needs migration MMM first") fails that match, so a restating file carries both guards. Source: `scripts/test-launch-contracts.ts`, `erasureContracts`, the two `assert.match(guard, …)` lines.
- When you restate a routine the launch contracts pin by file, move the pinned file name in the same commit. Source: `scripts/test-launch-contracts.ts`, `monthlyXpContracts` (`assert.equal(learn.file, 'supabase-schema-062.sql', …)`).

## 3. Keep the running code working

Production applies the migration while the previous code still serves traffic, and `main` can deploy before the migration lands. Source: the header of `supabase/supabase-schema-059.sql`; the header of `scripts/test-migration-fallbacks.ts`.

1. Keep every routine the production code calls: same name, arguments, result and grants. Change behaviour through a new routine with a `_v2` (or `_v3`) suffix. Sources: the headers of `supabase/supabase-schema-059.sql` (`save_coding_draft_v2`) and `supabase/supabase-schema-060.sql` (`complete_verified_roadmap_attempt_v2`, `record_verified_quiz_result_v3`).
2. Call the new routine first. When `isRpcMissing(error)` is true, call the previous one. When both are missing, answer 503 `migration_required`. Sources: `lib/http.ts`, `isRpcMissing`; `api/quiz/roadmap.ts`, the `complete_verified_roadmap_attempt_v2` call; `api/user/[op].ts`, the `record_verified_quiz_result_v3` call; `lib/coding/handlers.ts`, `storeDraft`.
3. Add the fallback case to `scripts/test-migration-fallbacks.ts`: its stand-in answers PGRST202 for any routine missing from `INSTALLED`, as PostgREST 12 does. Source: the header and `INSTALLED` in `scripts/test-migration-fallbacks.ts`.

## 4. Test it

1. Add one `supabase/tests/NNN-<topic>.test.sql`. Test files keep their own sequence, apart from the migration numbers: take the next number after the highest (`238-path-quota-result.test.sql` tests migration 066, so the next is 239). Source: the file list in `supabase/tests/`.
2. Write the checks as `ASSERT` statements inside `DO $$ … $$;` blocks. Add `SET LOCAL ROLE service_role;` first when the server calls the routines. `scripts/test-sql.mjs` wraps each file in `BEGIN` and `ROLLBACK` and turns on `plpgsql.check_asserts`, so a test leaves no rows behind. Sources: `scripts/test-sql.mjs`, step 4 and `psql()`; `supabase/tests/237-path-coding-reward.test.sql`.
3. `supabase/tests/known-failures.txt` only shrinks. Never add a line to hide a new failure; fix the SQL. A listed file that starts passing fails the suite until you remove its line. Source: the header of `supabase/tests/known-failures.txt`; `scripts/test-sql.mjs`, the `FIXED` branch.
4. Run the suite on an empty database. The script refuses a database with tables in `public`, so start a fresh container for every run. Source: the header of `scripts/test-sql.mjs`; `.github/workflows/quality.yml`, job `sql`, which uses the same image.

   ```sh
   PORT=54339 NAME=devshark-sql-$$   # pick a host port nothing listens on
   URL=postgres://postgres:postgres@127.0.0.1:$PORT/postgres
   docker run -d --name "$NAME" -p "$PORT":5432 -e POSTGRES_PASSWORD=postgres supabase/postgres:17.6.1.171
   until docker exec "$NAME" pg_isready -U postgres -h 127.0.0.1; do sleep 2; done
   DATABASE_URL="$URL" npm run test:sql
   psql "$URL" -X -v ON_ERROR_STOP=1 -f supabase/supabase-schema-NNN.sql
   docker rm -f "$NAME"
   ```

   Run the lines in one shell so the variables carry over. Check the port first with `lsof -i :$PORT`, and change `PORT` when it answers. The `psql` line applies the new file a second time on the built database and proves it safe to re-run. `npm run test:sql` needs `psql` on `PATH`.

## 5. Record it

1. Add an unticked deploy item to `NEEDED.md` in the shared marker format:

   ```md
   - [ ] **Apply migration NNN before the <feature> deploy** — `supabase/supabase-schema-NNN.sql` (<what it adds>). Apply it after MMM; the code in production keeps working with it applied, and the new code needs it. [imp:4] [owner:me] [time:5m] [kind:deploy]
   ```

   Source: `CLAUDE.md`, "Session routine & markdown conventions", for the markers.
2. Add a sentence that names the migration to the section of `docs/product-architecture.md` that owns the behaviour. Source: `docs/product-architecture.md`, "Learning paths" > "Contract and grading" ("… in one transaction (`supabase/supabase-schema-065.sql`)", "`accept_learning_path_quota_result` (migration 066)") and "Account erasure".
3. When someone applies it, tick the item and add the date and the pull request it preceded, then remove it at the next `markdown-checkup`.

## 6. Apply it to production

The owner, or an agent the owner authorised for that migration, applies it to production before the pull request that needs it merges. Do not apply a migration on your own initiative. Sources: `docs/launch-runbook.md`, "Database rollout"; `CLAUDE.md`, "Git workflow" (`main` merges only with `verify` and `sql` green).

1. Take and verify a backup first. Source: `docs/launch-runbook.md`, "Database rollout", step 1; `docs/backup-restore.md`.
2. Compare the project's applied migrations (the connector's `list_migrations`) with the repository before you assume a file is live or missing.
3. Apply the file in full through the Supabase SQL editor or the Supabase connector's `apply_migration`. When the connector fails on a large file, follow [references/apply-large-migration.md](references/apply-large-migration.md).
4. Prove production matches a fresh build of the repository by fingerprint. Source: `docs/release-acceptance.md`, "Migration 046 proof" ("matched this local chain by fingerprint").

For migrations from 077 onward, check the second-apply catalog and row-count fingerprint. New own-row reads require both an explicit authenticated SELECT grant and a matching policy. Revoke routine execution from PUBLIC on each new function. Name the actual caller of every definer in a catalog comment. Keep application data out of Realtime publications. The new migration template starts with the lock and statement timeouts immediately after BEGIN.

## Validation

| Command | What it proves |
|---|---|
| `DATABASE_URL=<empty Postgres> npm run test:sql` | The base schema and every numbered file apply in order on `supabase/postgres:17.6.1.171`, and every `supabase/tests/*.test.sql` passes or fails with its listed known text (`scripts/test-sql.mjs`). |
| `psql <same URL> -X -v ON_ERROR_STOP=1 -f supabase/supabase-schema-NNN.sql` | The new file re-runs cleanly on the database it already built. |
| `npm run test:fallbacks` | Each handler that names a fallback still answers when a routine is missing and PostgREST says PGRST202 (`scripts/test-migration-fallbacks.ts`). |
| `npm run typecheck:api` | The handlers that call the new routines still type-check. |
| `npm run test:launch` | The SQL-reading contracts hold: erasure coverage, the pinned newest definitions, definer `search_path` (`scripts/test-launch-contracts.ts`). |
| `git diff --check` | No whitespace errors in the new files. |

Report each command as pass, fail or not run, with the test-file summary line `test:sql` prints. Hand the finished migration to the `migration-reviewer` agent (`.claude/agents/migration-reviewer.md`) before you open the pull request.
