# Database migrations

Start a new database with `supabase-schema.sql`, then apply `supabase-schema-002.sql` and every numbered file in sequence. For an existing project compare its migration records **and catalog** with the repository. Some early records use a purpose instead of a file number. Migration 046 was applied through the SQL editor. Confirm the backup and release-specific prerequisites in [the deployment runbook](../docs/launch-runbook.md#database-rollout).

Apply files 002–076 once. Historical files 003, 005, 008, 011, 012, 013, 024, 032, 033, 048 and 064 fail on a second application. From 077 onward, each migration starts a transaction, immediately sets local lock and statement timeouts, and commits. The SQL runner applies each file twice and compares the catalog, grants, schedules and application table row counts between applications.

## Validate a change

Use an **empty, disposable local PostgreSQL database**. The SQL suite builds and mutates its entire schema. Production and hosted project URLs are outside its scope.

```sh
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54339/postgres \
  SQL_ADVISORS_JSON=./local-advisors.json npm run test:sql
```

The SQL suite runs each behavior fixture in a rolled-back transaction.

| Fixtures | Coverage |
|---|---|
| 010, 158, 233 | Application table security, actual learner reads across accounts, practice retention and access |
| 250 | Routine search paths, caller comments, direct execution and the explicit private-policy helper allowlist |
| 251, 252 | RLS predicates and roles, sequence and default grants, schema privileges and publication membership |
| 253–256 | Index hygiene, current-distribution counts, timestamp trigger and Hall of Fame name lookup |
| 260, 261 | Retired indexes and their replacement access paths, and the named daily purge when pg_cron is available |

Since 082, a new authenticated owner-read table needs both an explicit `GRANT SELECT TO authenticated` and an owner policy. Revoke routine execution from `PUBLIC` and browser roles, grant the intended caller explicitly, and attach a caller comment to each definer function. Application tables stay outside Realtime publications. Play broadcasts use a separate authorization mechanism.

The final suite stage runs [the pinned Supabase advisor queries](advisors/splinter.sql). Any ERROR fails the run, as does a SECURITY WARN in an application schema. Local index-use estimates reflect fixture traffic. The CI SQL log contains individual advisor rows. A change to a deployed project's findings needs a new observation after its migrations have been applied.

Use [the synthetic benchmark](bench/README.md) for query changes. Seed a scratch copy, collect seven runs per schema under comparable load, and record median times, buffers and plan names. Keep the production data and its statistics untouched.
