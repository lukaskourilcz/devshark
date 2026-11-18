-- Migration 077: run match_question_distribution on an empty search_path.
-- Apply after 076. Safe to re-run; the whole file is one transaction.
-- Compatible with the code in production (a9882348): api/play/[action].ts
-- calls match_question_distribution(p_match_id, p_question_idx) with the
-- service role, and the routine keeps its name, arguments, result columns,
-- body and grants. Only the search_path and the schema on match_answers change.
--
-- 005 created it SECURITY DEFINER with SET search_path = public, the last
-- definer routine still in use that resolves a table through the path.
-- Revert: re-run the CREATE block of supabase-schema-005.sql and the grants
-- for it in supabase-schema-023.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF to_regclass('public.match_answers') IS NULL
     OR to_regprocedure('public.match_question_distribution(uuid,integer)') IS NULL THEN
    RAISE EXCEPTION 'migration 077 needs public.match_answers and match_question_distribution (migration 005) first';
  END IF;
END;
$$;

-- COUNT and BOOL_AND resolve from pg_catalog, which an empty path still searches.
CREATE OR REPLACE FUNCTION public.match_question_distribution(
  p_match_id   UUID,
  p_question_idx INTEGER
)
RETURNS TABLE (selected_idx INTEGER, count INTEGER, correct BOOLEAN)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT a.selected_idx,
         COUNT(*)::INT AS count,
         BOOL_AND(a.is_correct) AS correct
    FROM public.match_answers a
   WHERE a.match_id = p_match_id
     AND a.question_idx = p_question_idx
   GROUP BY a.selected_idx
   ORDER BY a.selected_idx;
$$;

REVOKE ALL ON FUNCTION public.match_question_distribution(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_question_distribution(UUID, INTEGER) TO service_role;

COMMIT;
