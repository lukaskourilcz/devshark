-- Migration 072: keep a receipt for each concept review and apply a
-- precomputed transition only against the row it was computed from.
-- Apply after 071. Safe to re-run. The original review RPC and purge result
-- remain compatible with older app versions. No review rows are backfilled.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF to_regprocedure('public.record_concept_review(text,text,text,text,smallint,timestamptz,integer,text,text,text,boolean,integer)') IS NULL OR
     to_regprocedure('public.purge_expired_learning_data(timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'migration 072 needs migrations 030 and 061 first';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.concept_review_receipts (
  user_id TEXT NOT NULL,
  concept_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, concept_id, event_id),
  FOREIGN KEY (user_id, concept_id)
    REFERENCES public.concept_reviews(user_id, concept_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS concept_review_receipts_created_idx
  ON public.concept_review_receipts (created_at);
ALTER TABLE public.concept_review_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.concept_review_receipts FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_concept_review_v2(
  p_user_id TEXT, p_concept_id TEXT, p_subject TEXT, p_event_id TEXT,
  p_stage SMALLINT, p_due_at TIMESTAMPTZ, p_streak INTEGER, p_item_id TEXT,
  p_item_version TEXT, p_kind TEXT, p_correct BOOLEAN, p_policy_version INTEGER,
  p_expected_reviews INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '3s'
AS $$
DECLARE
  v_row public.concept_reviews%ROWTYPE;
  v_result JSONB;
BEGIN
  IF p_expected_reviews = 0 THEN
    INSERT INTO public.concept_reviews (user_id, concept_id, subject)
    VALUES (p_user_id, p_concept_id, p_subject)
    ON CONFLICT (user_id, concept_id) DO NOTHING;
  END IF;

  SELECT * INTO v_row FROM public.concept_reviews
   WHERE user_id = p_user_id AND concept_id = p_concept_id
   FOR UPDATE;
  IF NOT FOUND THEN
    -- Account erasure may remove a row after the caller read it. Do not
    -- recreate it from a transition made against that deleted revision.
    RETURN jsonb_build_object('applied', FALSE, 'state', 'gone');
  END IF;
  IF v_row.subject <> p_subject THEN
    RAISE EXCEPTION 'concept_review_subject_mismatch';
  END IF;

  IF v_row.last_event_id = p_event_id OR EXISTS (
    SELECT 1 FROM public.concept_review_receipts
     WHERE user_id = p_user_id AND concept_id = p_concept_id AND event_id = p_event_id
  ) THEN
    RETURN jsonb_build_object('applied', FALSE);
  END IF;

  IF v_row.reviews IS DISTINCT FROM p_expected_reviews THEN
    RETURN jsonb_build_object(
      'applied', FALSE, 'state', 'stale', 'reviews', v_row.reviews, 'stage', v_row.stage,
      'dueAt', v_row.due_at, 'streak', v_row.streak, 'lastItemId', v_row.last_item_id
    );
  END IF;

  -- During rollout the latest event may have been written by v1. Remember
  -- it before advancing the row, so a retry arriving after this save is safe.
  IF v_row.last_event_id IS NOT NULL THEN
    INSERT INTO public.concept_review_receipts (user_id, concept_id, event_id)
    VALUES (p_user_id, p_concept_id, v_row.last_event_id)
    ON CONFLICT DO NOTHING;
  END IF;

  v_result := public.record_concept_review(
    p_user_id, p_concept_id, p_subject, p_event_id, p_stage, p_due_at, p_streak,
    p_item_id, p_item_version, p_kind, p_correct, p_policy_version
  );
  INSERT INTO public.concept_review_receipts (user_id, concept_id, event_id)
  VALUES (p_user_id, p_concept_id, p_event_id);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.record_concept_review_v2(
  TEXT, TEXT, TEXT, TEXT, SMALLINT, TIMESTAMPTZ, INTEGER, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_concept_review_v2(
  TEXT, TEXT, TEXT, TEXT, SMALLINT, TIMESTAMPTZ, INTEGER, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER
) TO service_role;

CREATE OR REPLACE FUNCTION public.purge_expired_learning_data(
  p_before TIMESTAMPTZ DEFAULT NOW() - INTERVAL '90 days'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_roadmap INTEGER;
  v_submissions INTEGER;
  v_coding INTEGER;
  v_drafts INTEGER;
  v_commits INTEGER;
  v_path_attempts INTEGER;
  v_path_drafts INTEGER;
  v_auth_events INTEGER;
  v_practice_sessions INTEGER;
BEGIN
  DELETE FROM public.roadmap_attempts
   WHERE expires_at < p_before;
  GET DIAGNOSTICS v_roadmap = ROW_COUNT;
  DELETE FROM public.quiz_submissions
   WHERE created_at < p_before;
  GET DIAGNOSTICS v_submissions = ROW_COUNT;
  DELETE FROM public.coding_attempts
   WHERE created_at < p_before - INTERVAL '90 days';
  GET DIAGNOSTICS v_coding = ROW_COUNT;
  DELETE FROM public.coding_drafts
   WHERE updated_at < p_before;
  GET DIAGNOSTICS v_drafts = ROW_COUNT;
  DELETE FROM public.github_commits
   WHERE created_at < p_before - INTERVAL '90 days' AND status IN ('committed', 'skipped', 'failed');
  GET DIAGNOSTICS v_commits = ROW_COUNT;
  DELETE FROM public.learning_path_attempts
   WHERE state <> 'accepted' AND expires_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS v_path_attempts = ROW_COUNT;
  DELETE FROM public.learning_path_drafts
   WHERE updated_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS v_path_drafts = ROW_COUNT;
  -- 057: the sign-in log keeps a record for 12 months (privacy policy,
  -- "How long devShark keeps data").
  DELETE FROM public.auth_events
   WHERE created_at < NOW() - INTERVAL '12 months';
  GET DIAGNOSTICS v_auth_events = ROW_COUNT;
  v_practice_sessions := public.purge_practice_sessions(NOW() - INTERVAL '30 days');
  -- Quiz and Learn session tokens expire within two hours. Keep the
  -- duplicate receipts for seven days and the review state itself unchanged.
  DELETE FROM public.concept_review_receipts
   WHERE created_at < NOW() - INTERVAL '7 days';
  RETURN jsonb_build_object(
    'roadmapAttempts', v_roadmap, 'quizSubmissions', v_submissions,
    'codingAttempts', v_coding, 'codingDrafts', v_drafts, 'githubCommits', v_commits,
    'learningPathAttempts', v_path_attempts, 'learningPathDrafts', v_path_drafts,
    'authEvents', v_auth_events, 'practiceSessions', v_practice_sessions
  );
END;
$$;
REVOKE ALL ON FUNCTION public.purge_expired_learning_data(TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_learning_data(TIMESTAMPTZ) TO service_role;

COMMIT;
