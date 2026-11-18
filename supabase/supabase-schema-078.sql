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
--
-- Revert: run the CREATE OR REPLACE FUNCTION block of each routine again
-- (record_quiz_result from 002, global_leaderboard and daily_leaderboard from
-- 004, record_category_stats from 005) without the GRANT that follows it, then
-- REVOKE ALL ... FROM PUBLIC, anon, authenticated and GRANT EXECUTE ... TO
-- service_role on each, as 007 and 023 did.
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
    'global_leaderboard', 'daily_leaderboard', 'record_quiz_result', 'record_category_stats'  -- 1
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

COMMIT;
