# Database plans and timings, November 2026

Package F8 of Epic F (#637). This file records how the hot reads behave at 20,000 learners before migrations 077 and later change an index or a policy, and the advisor counts on the same day. The commits that add those indexes and policies record their after numbers here. `README.md` in this folder explains the seed and the script.

## Method

| | |
|---|---|
| Schema | `supabase-schema.sql` and migrations 002 to 076 as `npm run test:sql` builds them, at `main` `a9882348` |
| Postgres | 17.11 (Homebrew) on an Apple M3 laptop, 16 GB, 8 cores; `shared_buffers` 128 MB, `work_mem` 4 MB, `effective_cache_size` 4 GB, `max_parallel_workers_per_gather` 2, JIT on (no plan reached its cost threshold) |
| Load | `seed.sql` on a `createdb -T` copy: 20,000 learners, 1,343 MB, loaded in 5 min 49 s and 7 min 42 s |
| Runs | seven runs of `explain.sql` one after another; medians, spread and pages from `medians.mjs` |
| Lock | the audit's `scratchpad/bin/heavy --exclusive`, which held every build and browser slot of the other agents |

Production runs Postgres 17.6 on Supabase's build with other memory settings, so read the milliseconds as relative. The pages column counts the shared buffers the plan's top node hit or read. It does not move with load, and it moves when a plan changes.

## Noise

A second seeded copy (copy B, loaded in 5 min 49 s) produced the same plan nodes and the same pages as copy A on all 17 reads. Its milliseconds followed the machine's load. Copy B ran twice: once when other agents pushed the one-minute load average to 98, once at 2.7 after they finished. Medians of seven runs each:

| # | Copy A, load 10.3 | Copy B, load 98 | Copy B, load 2.7 | Pages, all three |
|---|---:|---:|---:|---:|
| 01 | 145.0 | 169.4 | 74.4 | 4,820 |
| 02 | 66.8 | 107.4 | 35.2 | 3,983 |
| 03 | 33.4 | 72.5 | 20.4 | 1,113 |
| 04 | 46.0 | 70.3 | 27.2 | 1,901 |
| 05 | 30.8 | 54.4 | 18.2 | 1,113 |
| 06 | 134.8 | 237.6 | 73.8 | 15,116 |
| 07 | 466.9 | 889.0 | 272.5 | 15,266 |
| 08 | 10.7 | 12.9 | 6.19 | 2,222 |
| 09 | 0.336 | 0.382 | 0.140 | 50 |
| 10 | 5.01 | 6.42 | 2.61 | 547 |
| 11 | 22.6 | 27.6 | 11.9 | 3,131 |
| 12 | 0.104 | 0.188 | 0.054 | 43 |
| 13 | 0.059 | 0.106 | 0.030 | 13 |
| 14 | 0.055 | 0.086 | 0.026 | 13 |
| 15 | 0.024 | 0.037 | 0.012 | 3 |
| 16 | 0.911 | 1.00 | 0.471 | 156 |
| 17 | 0.042 | 0.065 | 0.021 | 5 |

On the quiet machine each read took 0.42 to 0.61 times its copy A median; at load 98 it took 1.10 to 2.17 times. Between sittings, then, a time that moves by less than a factor of 2.5 says nothing. Compare milliseconds only on one copy in one sitting, before and after a migration, as the README says, and treat a change in pages as the signal.

## Before: 17 reads (copy A, 18 November 2026)

The one-minute load average read 10.3 when the runs started.

| # | Read | Plan | Median ms | Min to max ms | Pages |
|---|---|---|---:|---:|---:|
| 01 | `window_leaderboard`, 30 days, every category | bitmap scan of `user_activity_days_day_idx` (300,000 rows), hash join to `user_stats` | 145.0 | 119.9 to 198.2 | 4,820 |
| 02 | `window_leaderboard_rank`, 30 days | parallel bitmap scan of `user_activity_days_day_idx` | 66.8 | 56.5 to 121.5 | 3,983 |
| 03 | `month_xp_ranks`, behind 04 and 05 | index scan of `user_xp_days_subject_day_idx` | 33.4 | 29.8 to 62.4 | 1,113 |
| 04 | `month_xp_leaderboard` | function scan of `month_xp_ranks`, seq scan of `user_stats` | 46.0 | 39.1 to 189.3 | 1,901 |
| 05 | `month_xp_leaderboard_rank`, the viewer's own month XP | function scan of `month_xp_ranks`: every learner's month to return one row | 30.8 | 25.8 to 94.9 | 1,113 |
| 06 | `category_leaderboard`, javascript, all time | seq scan of `user_activity_days` (1.2 M rows) | 134.8 | 112.9 to 278.1 | 15,116 |
| 07 | `subject_leaderboard`, all time | seq scan of `user_activity_days` | 466.9 | 400.1 to 929.2 | 15,266 |
| 08 | `daily_leaderboard_v2`, today | index scan of `idx_daily_attempts_date_score`, `idx_user_stats_user_id` per row | 10.7 | 9.55 to 17.1 | 2,222 |
| 09 | `challenge_leaderboard`, top ten | index scan of `challenge_scores_subject_rank_idx` | 0.336 | 0.218 to 0.472 | 50 |
| 10 | `friend_list` | bitmap OR of `friendships_low_state_idx` and `friendships_high_state_idx`, index scans per friend | 5.01 | 3.76 to 6.15 | 547 |
| 11 | Hall of Fame name check in `allocate_shark_name` | parallel seq scan of `challenge_scores` (200,000 rows) | 22.6 | 17.6 to 27.2 | 3,131 |
| 12 | coding progress, passed tasks | bitmap scan of `coding_progress_pkey` | 0.104 | 0.083 to 0.144 | 43 |
| 13 | coin ledger, last 25 | bitmap scan of `token_ledger_user_idx`, subject filter, sort | 0.059 | 0.044 to 0.084 | 13 |
| 14 | Shark Cards list | bitmap scan of `idx_flashcards_user`, subject filter, sort | 0.055 | 0.045 to 0.072 | 13 |
| 15 | `user_stats` row | index scan of `idx_user_stats_user_id` | 0.024 | 0.018 to 0.035 | 3 |
| 16 | `question_edits` refresh with `OVERRIDE_COLUMNS` | seq scan, 3,000 rows | 0.911 | 0.732 to 1.41 | 156 |
| 17 | daily coin cap in `credit_verified_xp_tokens` | index scan of `token_xp_credits_user_day_idx` | 0.042 | 0.031 to 0.086 | 5 |

### Daily purge

`purge_expired_learning_data()` on copy A, four runs, each rolled back: 565 ms for the first (cold pages), then 188, 155 and 248 ms. One run deletes 24,960 coding attempts, 37,500 quiz submissions and 24,157 roadmap attempts, the 120-day backlog the seed leaves.

### What the plans point at

- 11 scans all 200,000 Hall of Fame rows for one name while `allocate_shark_name` holds the global Sharkname counter lock.
- 08, 10 and 15 read `user_stats` through `idx_user_stats_user_id`, an exact copy of `user_stats_user_id_key`.
- 08 reads `idx_daily_attempts_date_score`; `daily_attempts_subject_rank_idx` starts with the same column and adds the subject the read filters on.
- 14 reads `idx_flashcards_user`, filters the subject and sorts; `flashcards_user_subject_created_idx` matches the filter and the order.
- 06 and 07 read all 1.2 M activity rows on every all-time board request: 15,000 pages each. At 20,000 learners they are the slowest reads in the list.
- 05 computes every learner's month XP to return the viewer's row, at the cost of the whole month board.

## Advisors before

`npm run test:sql` on a fresh Postgres 17.11 database runs splinter `cc529aa9` (`supabase/advisors/splinter.sql`) after the 71 behaviour tests:

| Level | Category | Lint | Count |
|---|---|---|---:|
| WARN | performance | `auth_rls_initplan` | 39 |
| INFO | performance | `unused_index` | 23 |
| INFO | performance | `no_primary_key` | 1 |
| INFO | security | `rls_enabled_no_policy` | 33 |

No ERROR and no security WARN.

Production (`get_advisors` through the Supabase MCP, read-only, observed 18 November 2026 19:16 UTC):

| Advisor | Level | Lint | Count |
|---|---|---|---:|
| Security | INFO | `rls_enabled_no_policy` | 33 |
| Performance | WARN | `auth_rls_initplan` | 39 |
| Performance | INFO | `unused_index` | 16 |
| Performance | INFO | `no_primary_key` (`friendships`) | 1 |
| Performance | INFO | `auth_db_connections_absolute` (Auth capped at 10 connections) | 1 |

The two `unused_index` counts differ because each reads its own statistics: the local one counts the scans of the 71 tests, production the scans of real traffic since its statistics last reset. F1 commits the full production export as `docs/audit/database-advisors-2026-11.json`.
