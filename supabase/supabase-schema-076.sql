-- Migration 076: settle first-pass Learn coins and the last-heart streak
-- in the same transaction as completion. Apply after 075. Safe to re-run.
-- Older callers can still use both existing completion routines.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF to_regprocedure('public.complete_verified_roadmap_attempt_v2(text,text,jsonb)') IS NULL
     OR to_regprocedure('public.credit_verified_xp_tokens(text,text,text,integer,numeric,integer,integer)') IS NULL
     OR to_regprocedure('public.advance_verified_streak(text)') IS NULL THEN
    RAISE EXCEPTION 'migration 076 needs the verified Learn completion and reward routines';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_verified_roadmap_attempt_v3(
  p_user_id TEXT,
  p_attempt_id TEXT,
  p_coding_task_ids JSONB,
  p_coin_rate NUMERIC,
  p_coin_multiplier INTEGER,
  p_coin_daily_cap INTEGER
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '3s' AS $$
DECLARE
  v_result JSONB;
  v_attempt public.roadmap_attempts%ROWTYPE;
  v_award TEXT;
BEGIN
  v_result := public.complete_verified_roadmap_attempt_v2(p_user_id, p_attempt_id, p_coding_task_ids);
  IF v_result->'firstPass' = 'true'::JSONB THEN
    SELECT * INTO STRICT v_attempt FROM public.roadmap_attempts WHERE attempt_id = p_attempt_id;
    v_award := 'learn:' || public.token_account_key(p_user_id) || ':' || v_attempt.topic || ':'
      || CASE WHEN v_attempt.kind = 'level' THEN 'L' ELSE 'P' END || v_attempt.ref::TEXT;
    PERFORM public.credit_verified_xp_tokens(
      p_user_id, v_award, v_attempt.subject, public.learn_step_xp(v_attempt.kind, v_attempt.ref),
      p_coin_rate, p_coin_multiplier, p_coin_daily_cap
    );
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_roadmap_attempt_on_hearts(
  p_user_id TEXT,
  p_attempt_id TEXT
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '3s' AS $$
DECLARE
  v_attempt public.roadmap_attempts%ROWTYPE;
  v_answered INTEGER;
  v_wrong INTEGER;
BEGIN
  SELECT * INTO v_attempt FROM public.roadmap_attempts
   WHERE attempt_id = p_attempt_id FOR UPDATE;
  IF NOT FOUND OR p_user_id IS NULL OR v_attempt.user_id IS DISTINCT FROM p_user_id
     OR v_attempt.expires_at < NOW() OR v_attempt.kind <> 'level' THEN
    RAISE EXCEPTION 'invalid_roadmap_attempt';
  END IF;
  IF v_attempt.completed_at IS NOT NULL THEN RETURN FALSE; END IF;

  SELECT count(*), count(*) FILTER (WHERE NOT is_correct)
    INTO v_answered, v_wrong
    FROM public.roadmap_attempt_answers WHERE attempt_id = p_attempt_id;
  -- ROADMAP_MAX_HEARTS is three. A full round keeps its existing percentage
  -- grading and a part test never uses hearts.
  IF v_answered >= v_attempt.total_questions OR v_wrong < 3 THEN
    RAISE EXCEPTION 'incomplete_roadmap_attempt';
  END IF;

  UPDATE public.roadmap_attempts SET
    completed_at = NOW(),
    score_pct = ROUND(100.0 * (v_answered - v_wrong) / v_attempt.total_questions)::INTEGER,
    passed = FALSE
   WHERE attempt_id = p_attempt_id;
  PERFORM public.advance_verified_streak(p_user_id);
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_verified_roadmap_attempt_v3(TEXT, TEXT, JSONB, NUMERIC, INTEGER, INTEGER),
  public.complete_roadmap_attempt_on_hearts(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_verified_roadmap_attempt_v3(TEXT, TEXT, JSONB, NUMERIC, INTEGER, INTEGER),
  public.complete_roadmap_attempt_on_hearts(TEXT, TEXT) TO service_role;
COMMIT;
