# Supabase backup, restore and recovery drill

This procedure protects the production database, Supabase project `rvlybcjdpafwyeuojvhl` (eu-north-1). Verify a backup before every migration, before destructive maintenance, and on a regular schedule.

## Objectives and current state

The owner set **RPO 24 hours** (maximum lost data) and **RTO 1 hour** (from declaring an incident to restored, verified service). Provisioning a project alone does not meet the RTO; configuration, validation and cutover count too.

Production takes daily physical backups (WAL-G); point-in-time recovery is off. `supabase backups list` for the project is the check: before migration 066 on 22 October 2026 it showed a completed backup from that morning and one for each of the seven days before (`docs/release-acceptance.md`, "Migration 066 in production"). A listed backup shows availability, not that it restores.

The recovery project used for drills, `devshark-recovery-20260915` (`fgalpbaebgnybmqpitom`), was deleted on 20 November 2026 together with the personal data copied into it on 15 September 2026. A drill creates a new recovery project and deletes it afterwards. No timed restore, application validation or cutover has been run, so **the RTO is unmeasured** (`NEEDED.md`).

Supabase's [clone documentation](https://supabase.com/docs/guides/platform/clone-project) separates database and auth records from configuration and storage objects. Restoring rows does not restore Auth settings, redirect URLs, Realtime settings, Edge Functions or object storage, so inventory those separately. Disable copied scheduled or external jobs in a recovery copy to avoid duplicate side effects.

## Backup

1. Record the project ref, Postgres version, newest applied migration, UTC start time and the person taking the backup.
2. Confirm the managed daily backup with `supabase backups list`. For maintenance that can destroy data, also take an encrypted logical backup with `supabase db dump` or `pg_dump`, using a short-lived database credential. Never commit dumps or credentials.
3. Include schema, functions, triggers, grants, RLS policies and data. Auth identities live in the `auth` schema and need an authorized Supabase recovery path; confirm the chosen backup includes them.
4. Store a logical backup encrypted, in access-controlled storage outside the production project, with its SHA-256 checksum and retention date.
5. Capture non-secret Vercel and Supabase configuration separately: product identity, allowed redirect origins, Realtime settings and feature switches.

## Restore drill

Never test a restore over the production database.

1. Use an isolated recovery project with no public production domain.
2. Restore the managed backup or logical dump with the documented Supabase mechanism for that backup type.
3. Apply only the migrations newer than the backup, in numeric order.
4. Compare row counts for user stats, category stats, question history, roadmap progress and attempts, flashcards, matches, challenge and daily scores, the verified award and quiz ledgers, the token ledger and balances, coding progress and drafts, learning-path tables, reports and settings.
5. Verify routines and privileges, especially `record_verified_quiz_result_v3`, `record_verified_activity_xp`, `complete_verified_roadmap_attempt_v2`, `apply_verified_skill_check`, `credit_verified_xp_tokens`, `accept_learning_path_result`, `accept_learning_path_quota_result` and `delete_user_data`, together with RLS on every table and the absence of browser write grants. `supabase/tests/010-schema-security.test.sql` and `158-rls-own-rows-only.test.sql` show the queries that prove it.
6. Point a private preview deployment at the recovery project, run `npm run test:launch`, then run the [preview smoke test](launch-runbook.md#preview-smoke-test) without real-user credentials.
7. Record the recovery time and the recovery point reached. Fix this procedure if either misses the objective.

## Production recovery

Freeze writes and preserve evidence first. Restore to a separate project, validate it, then switch the server and client Supabase environment values together. Reconfirm Google OAuth redirects, the SMTP sender and Realtime. Rotate any credential exposed during the incident and invalidate affected sessions.

After recovery, verify `/api/health`, quiz receipt idempotency, multiplayer, admin authorization and account erasure. Document the data-loss window, user impact, notification decision, root cause and prevention work.
