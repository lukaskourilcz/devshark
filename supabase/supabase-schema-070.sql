-- Migration 070: serialize draft saves within each learning-path enrollment.
-- Apply after 069. Safe to re-run. Older app versions still call the original
-- routine with the same arguments and result. No draft rows change on rollout.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF to_regprocedure('public.save_learning_path_draft(text,text,text,integer,jsonb,integer)') IS NULL THEN
    RAISE EXCEPTION 'migration 070 needs migration 026 first';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_learning_path_draft_v2(
  p_user_id TEXT,
  p_enrollment_id TEXT,
  p_activity_id TEXT,
  p_expected_revision INTEGER,
  p_content JSONB,
  p_max_drafts INTEGER DEFAULT 20
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '3s'
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.learning_path_enrollments
    WHERE enrollment_id = p_enrollment_id AND user_id = p_user_id
  ) THEN
    RETURN jsonb_build_object('ok', FALSE, 'reason', 'not_found');
  END IF;

  -- Two first saves for different activities have no shared draft row to
  -- lock. Serialize their cap check and insert without holding an enrollment
  -- row lock across the old routine's draft lock.
  PERFORM pg_advisory_xact_lock(hashtextextended('devshark:path-draft:' || p_enrollment_id, 0));
  RETURN public.save_learning_path_draft(
    p_user_id, p_enrollment_id, p_activity_id, p_expected_revision, p_content, p_max_drafts
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_learning_path_draft_v2(TEXT, TEXT, TEXT, INTEGER, JSONB, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_learning_path_draft_v2(TEXT, TEXT, TEXT, INTEGER, JSONB, INTEGER)
  TO service_role;
COMMIT;
