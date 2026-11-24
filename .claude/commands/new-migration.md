---
description: Scaffold the next numbered Supabase migration with its SQL test stub and its NEEDED deploy item, then prove the scaffold passes the SQL suite.
argument-hint: <purpose> [--after <NNN>]
allowed-tools: Read, Grep, Glob, Bash, Edit, Write
---

Scaffold a migration for `$ARGUMENTS` by following `.claude/skills/supabase-migration/SKILL.md`. Read the skill first; this command writes the empty shapes, and you fill them.

1. Inspect `git status --short` and `git fetch origin main`. Preserve unrelated work.
2. Take the next migration number: the highest `supabase/supabase-schema-NNN.sql` here or on `origin/main`, plus one, padded to three digits. Take the next test number the same way from `supabase/tests/NNN-*.test.sql`. Build a kebab-case slug of three to five words from the purpose. The predecessor is `<NNN-1>`, or the number given with `--after` when the migration depends on an earlier file; name the same predecessor in the header (step 3) and the deploy item (step 5).
3. Write `supabase/supabase-schema-<NNN>.sql` with the header and the transaction, and nothing between them yet:

   ```sql
   -- Migration <NNN>: <purpose, one sentence>. Apply after migration <NNN-1 or --after>.
   -- Safe to re-run; the whole file is one transaction. Compatible with the code
   -- in production (<git rev-parse --short origin/main>): <fill in>.
   BEGIN;
   SET LOCAL lock_timeout = '5s';
   SET LOCAL statement_timeout = '30s';
   COMMIT;
   ```

4. Write `supabase/tests/<test number>-<slug>.test.sql`:

   ```sql
   -- Migration <NNN>: <purpose>. STUB: replace the assertion below with the
   -- behaviour the migration adds before the pull request opens.
   SET LOCAL ROLE service_role;
   DO $$
   BEGIN
     ASSERT current_setting('plpgsql.check_asserts') = 'on', 'test:sql runs with assertions on';
   END;
   $$;
   ```

5. Add an unticked item to `NEEDED.md`, in the section of the work the migration belongs to, using the skill's wording and markers:

   ```md
   - [ ] **Apply migration <NNN> before the <feature> deploy** — `supabase/supabase-schema-<NNN>.sql` (<what it adds>). Apply it after <NNN-1 or --after>; the code in production keeps working with it applied, and the new code needs it. [imp:4] [owner:me] [time:5m] [kind:deploy]
   ```

6. Prove the scaffold on an empty database. The script refuses a database that already has tables, so start a fresh container and remove it after the run. Set `PORT` to a host port nothing listens on (`lsof -i :$PORT` prints nothing) and run the lines in one shell:

   ```sh
   PORT=54339 NAME=devshark-sql-$$
   URL=postgres://postgres:postgres@127.0.0.1:$PORT/postgres
   docker run -d --name "$NAME" -p "$PORT":5432 -e POSTGRES_PASSWORD=postgres supabase/postgres:17.6.1.171
   until docker exec "$NAME" pg_isready -U postgres -h 127.0.0.1; do sleep 2; done
   docker exec -i "$NAME" psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < supabase/tests/realtime-fixture.sql
   DATABASE_URL="$URL" npm run test:sql
   psql "$URL" -X -v ON_ERROR_STOP=1 -f supabase/supabase-schema-<NNN>.sql
   docker rm -f "$NAME"
   git diff --check
   ```

7. Then write the body (skill section 2), the `_v2` routine and its `isRpcMissing` fallback when the change alters a routine production calls (section 3), the real assertions (section 4) and the `docs/product-architecture.md` sentence (section 5). Rerun step 6 on a fresh container after each change to the SQL.

Report the three paths, the two numbers, the `Applied N schema files` line and the summary line `test:sql` printed, and the result of the second apply and of `git diff --check`. Leave the files uncommitted unless the caller asked for a commit. Do not apply anything to a Supabase project: the owner, or an agent the owner authorised for this migration, does that before the code merges (skill section 6).


When filling this scaffold, grant authenticated SELECT explicitly for each intended owner-read table, revoke PUBLIC EXECUTE on each routine, name each definer's caller in a catalog comment and keep application tables outside publications. test:sql compares the second-apply catalog and row-count fingerprint.
