-- Migration 079: drop the tables and the budget routine of the retired AI
-- features. Apply after 078. Safe to re-run; the whole file is one
-- transaction. Compatible with the code in production (a9882348): no handler,
-- library, client file, routine body or cron job reads or writes these tables
-- or calls the routine.
--
-- devShark ships no AI feature. 021 created question_explanations for
-- post-answer AI explanations, 024 question_hints for the Sharkira hint cache,
-- and 022 the ai_generation_budget ledger with claim_ai_generation_budget, the
-- SECURITY DEFINER routine that claimed a slot in it. The tables hold shared
-- content with no account column, so delete_user_data never named them, and
-- production holds no row in any of them (read on 18 November 2026). They
-- account for three of the rls_enabled_no_policy notices, and their two
-- review indexes for two of the unused_index notices.
--
-- Revert: run again the CREATE TABLE, CREATE INDEX, ENABLE ROW LEVEL SECURITY
-- and REVOKE statements of question_explanations (021), ai_generation_budget
-- (022) and question_hints (024 section 6), then the CREATE OR REPLACE
-- FUNCTION, REVOKE and GRANT statements of claim_ai_generation_budget (022).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ---------------------------------------------------------------------------
-- 0. Refuse while a table holds a row, or while a routine body or cron job
--    other than claim_ai_generation_budget names a table or the routine.
--    Postgres records neither as a dependency, so a plain DROP would succeed
--    and lose the rows or leave that caller to fail later.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_tables  CONSTANT TEXT[] := ARRAY['question_explanations', 'question_hints', 'ai_generation_budget'];
  v_pattern CONSTANT TEXT := '\m(' || array_to_string(v_tables, '|') || '|claim_ai_generation_budget)\M';
  v_table   TEXT;
  v_found   BOOLEAN;
  v_callers TEXT;
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I)', v_table) INTO v_found;
      IF v_found THEN
        RAISE EXCEPTION 'migration 079 drops public.%, which holds rows; export them first', v_table;
      END IF;
    END IF;
  END LOOP;

  SELECT string_agg(p.oid::regprocedure::TEXT, ', ' ORDER BY p.oid::regprocedure::TEXT) INTO v_callers
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE p.prosrc ~ v_pattern
     AND NOT (n.nspname = 'public' AND p.proname = 'claim_ai_generation_budget');
  IF v_callers IS NOT NULL THEN
    RAISE EXCEPTION 'migration 079 drops tables or a routine that % still name', v_callers;
  END IF;

  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT string_agg(jobname, '', '' ORDER BY jobname) FROM cron.job WHERE command ~ $1'
       INTO v_callers USING v_pattern;
    IF v_callers IS NOT NULL THEN
      RAISE EXCEPTION 'migration 079 drops tables or a routine that the cron jobs % still name', v_callers;
    END IF;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1. The routine first, then the tables with their indexes and constraints.
--    RESTRICT is the default: a drop fails, and changes nothing, if a view,
--    policy or foreign key depends on the object.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.claim_ai_generation_budget(DATE, INTEGER);  -- 022
DROP TABLE IF EXISTS public.question_explanations;                         -- 021
DROP TABLE IF EXISTS public.question_hints;                                -- 024
DROP TABLE IF EXISTS public.ai_generation_budget;                          -- 022

COMMIT;
