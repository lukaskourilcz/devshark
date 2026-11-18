-- Migration 078: drop SECURITY DEFINER routines that nothing calls. Apply
-- after 077. Safe to re-run; the whole file is one transaction. Compatible
-- with the code in production (a9882348): no handler, library, client file,
-- routine body or cron job names a routine this file drops, and each drop
-- removes only that routine and its grants.
--
-- 1. The leaderboard and stats routines of 002, 004 and 005: the last definer
--    routines in public that resolve tables through search_path=public.
--    global_leaderboard and daily_leaderboard build names from email and
--    ignore show_on_leaderboards; record_quiz_result and record_category_stats
--    write stats with no verified attempt. 007 and 023 took them from the
--    browser roles, and 023 kept the leaderboards "for rollback
--    compatibility". api/leaderboard.ts calls daily_leaderboard_v2 and answers
--    503 when it is missing, with no fallback to the first version.
-- 2. Three service-role routines their callers retired:
--    record_verified_quiz_result (021), which api/user/[op].ts replaced with
--    _v3 and its _v2 fallback; delete_learning_path_data (026), which no
--    handler ever called; and credit_social_visit (041), which
--    lib/rewards/coins.ts stopped calling when opening a social profile
--    stopped paying (design audit P0.3). Production has no
--    credit_social_visit (read on 18 November 2026), so IF EXISTS makes that
--    drop a no-op there.
-- 3. grant_daily_queue_cards (047), the routine of the collectible card
--    packs that owner decision 12 retired (1 October 2026). api/user/[op].ts
--    answers op=cards with 410, and scripts/product-cleanup-contracts.ts
--    fails if api, lib, shared or client/src call it again. The user_cards
--    and daily_queue_completions rows stay, and delete_user_data still
--    erases them.
--
-- Revert, per group:
-- 1. Run the CREATE OR REPLACE FUNCTION block of each routine again
--    (record_quiz_result from 002, global_leaderboard and daily_leaderboard
--    from 004, record_category_stats from 005) without the GRANT that follows
--    it, then REVOKE ALL ... FROM PUBLIC, anon, authenticated and GRANT
--    EXECUTE ... TO service_role on each, as 007 and 023 did.
-- 2. Run the CREATE OR REPLACE FUNCTION, REVOKE and GRANT statements of
--    record_verified_quiz_result from 021, delete_learning_path_data from 026
--    section 8 and credit_social_visit from 041 again.
-- 3. Run the CREATE OR REPLACE FUNCTION, REVOKE and GRANT statements of
--    grant_daily_queue_cards from 047 section 7 again.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- 0. Refuse while anything still names a routine this file drops. A plpgsql
--    body and a cron job name a routine as text, which Postgres does not
--    record as a dependency, so a plain DROP would succeed and leave that
--    caller to fail later. A view, policy or default that depends on one makes
--    its DROP fail instead (RESTRICT is the default).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_names   CONSTANT TEXT[] := ARRAY[
    'global_leaderboard', 'daily_leaderboard', 'record_quiz_result', 'record_category_stats',  -- 1
    'record_verified_quiz_result', 'delete_learning_path_data', 'credit_social_visit',          -- 2
    'grant_daily_queue_cards'                                                                   -- 3
  ];
  v_pattern CONSTANT TEXT := '\m(' || array_to_string(v_names, '|') || ')\M';
  v_callers TEXT;
BEGIN
  SELECT string_agg(p.oid::regprocedure::TEXT, ', ' ORDER BY p.oid::regprocedure::TEXT) INTO v_callers
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE p.prosrc ~ v_pattern
     AND NOT (n.nspname = 'public' AND p.proname = ANY (v_names));
  IF v_callers IS NOT NULL THEN
    RAISE EXCEPTION 'migration 078 drops routines that % still call', v_callers;
  END IF;

  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT string_agg(jobname, '', '' ORDER BY jobname) FROM cron.job WHERE command ~ $1'
       INTO v_callers USING v_pattern;
    IF v_callers IS NOT NULL THEN
      RAISE EXCEPTION 'migration 078 drops routines that the cron jobs % still call', v_callers;
    END IF;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1. The legacy leaderboards and the unverified stats writers.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.global_leaderboard(INTEGER);                   -- 004
DROP FUNCTION IF EXISTS public.daily_leaderboard(DATE, INTEGER);              -- 004
DROP FUNCTION IF EXISTS public.record_quiz_result(TEXT, INTEGER, INTEGER);    -- 002
DROP FUNCTION IF EXISTS public.record_category_stats(TEXT, JSONB);            -- 005

-- ---------------------------------------------------------------------------
-- 2. The retired service routines. The _v2 and _v3 quiz writers stay.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.record_verified_quiz_result(TEXT, TEXT, INTEGER, INTEGER, JSONB, TEXT, TEXT, TEXT);  -- 021
DROP FUNCTION IF EXISTS public.delete_learning_path_data(TEXT, TEXT);                                              -- 026
DROP FUNCTION IF EXISTS public.credit_social_visit(TEXT, TEXT, TEXT, INTEGER);                                     -- 041

-- ---------------------------------------------------------------------------
-- 3. The card pack grant. Its tables and their rows stay.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.grant_daily_queue_cards(TEXT, TEXT, DATE, JSONB);  -- 047

COMMIT;
