# Query plans at scale

Production holds about a dozen accounts, so every table there fits in a page or two and every plan is a sequential scan. These files load a scratch database with 20,000 synthetic learners and print the plans and timings the leaderboards, friends, coding progress, coins, Shark Cards, the question overrides and the XP coin cap will get at that size.

| File | What it does |
|---|---|
| `seed.sql` | Loads 20,000 learners with about 120 days of history (1.2 M activity days, 600,000 XP days, 1.2 M XP credits, 200,000 Hall of Fame runs, 3,000 question overrides and the rest). About 1.3 GB and 8 minutes on a laptop. |
| `explain.sql` | Prints `EXPLAIN (ANALYZE, BUFFERS)` for 17 reads under `### 01` to `### 17` headings, inside a read-only transaction. |
| `medians.mjs` | Turns several `explain.sql` outputs into one table: median, spread and pages per read. |

Nothing here is a migration: `scripts/test-sql.mjs` and `scripts/test-launch-contracts.ts` read only `supabase/supabase-schema*.sql` at the top of `supabase/`.

## Never on a Supabase project

Run the seed only on a copy of a database that `npm run test:sql` built on your machine, and drop it afterwards. `seed.sql` refuses a database named `postgres` (the name of every Supabase project and of CI's database) and one whose `public.user_stats` or `auth.users` has a row, which also stops a second run on the same copy. `explain.sql` refuses a database the seed did not load. Production gets plain `EXPLAIN` at most, never this load.

## Run it

```sh
export PGHOST=127.0.0.1 PGPORT=54339 PGUSER=postgres
createdb bench_base
DATABASE_URL=postgres://postgres@127.0.0.1:54339/bench_base npm run test:sql
createdb -T bench_base bench
psql -X -d bench -f supabase/bench/seed.sql      # about 8 minutes
for i in 1 2 3 4 5 6 7; do psql -X -d bench -f supabase/bench/explain.sql > run-$i.txt; done
node supabase/bench/medians.mjs run-*.txt
dropdb bench; dropdb bench_base
```

`createdb -T` copies the built schema in a second, so one `test:sql` build serves several seeded copies.

## Timing rules

- Time on a machine with nothing else running. In the Epic F audit that meant `scratchpad/bin/heavy --exclusive`, which holds every build and browser slot of the other agents.
- Take the median of seven runs of the whole script. Each run goes through all 17 reads in turn, so the runs interleave and a burst of load lands on every read instead of one. The first run can read pages from disk; the median of seven sets it aside.
- Compare before and after on the same seeded copy: time it, apply the new migration with `psql -X -d bench -v ON_ERROR_STOP=1 -f supabase/supabase-schema-NNN.sql`, run `ANALYZE`, time it again. To try an index before it is a migration, create it, time it and drop it again on the copy.
- Report the pages column with the time: it does not move with load, so it shows a plan change that the milliseconds blur.

## How the reads are run

The leaderboard and friend reads are SQL `SECURITY DEFINER` routines, and Postgres never inlines those, so `EXPLAIN SELECT * FROM public.window_leaderboard(…)` shows only a Function Scan. `explain.sql` reads each routine's current body from `pg_proc`, prepares it with `$1`, `$2`, … for its arguments, and runs it with `plan_cache_mode = force_generic_plan`. That matches what the routine runs: Postgres 17 plans the statement inside an SQL routine without the argument values. With `auto_explain.log_nested_statements` on, `window_leaderboard(30, 100, 'javascript', 5, …)` keeps `(($3 IS NULL) OR (category = $3))` as a filter instead of folding it. Because the body comes from the catalog, a migration that rewrites a routine changes what the script measures, with no copy to update.

The other reads are the statements PostgREST and the plpgsql routines send (`lib/coding/handlers.ts`, `lib/rewards/handlers.ts`, `api/flashcards.ts`, `api/user/[op].ts`, `lib/questions-store.ts`, `allocate_shark_name` in migration 063, `credit_verified_xp_tokens` in 041), with the arguments written in. Every read is for learner `…000040`, who has activity, XP and coin credits today.

The seed turns triggers off while it loads (`session_replication_role = replica`), so it needs a superuser and writes the derived rows itself.
