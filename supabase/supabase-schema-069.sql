-- Migration 069: seal a new Challenge run after its third recorded strike.
-- Apply after 068. Safe to re-run. Existing quiz claims and the routine used
-- by the previous deployment stay available, with their original behavior.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.claim_quiz_submission(text,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'migration 069 needs migration 023 first';
  END IF;
END;
$$;

ALTER TABLE public.quiz_submissions
  ADD COLUMN IF NOT EXISTS challenge_verdict TEXT CHECK (challenge_verdict IN ('correct', 'strike', 'void'));

CREATE INDEX IF NOT EXISTS quiz_submissions_challenge_strikes_idx
  ON public.quiz_submissions (attempt_id)
  WHERE challenge_verdict = 'strike';

CREATE OR REPLACE FUNCTION public.claim_challenge_answer(
  p_grade_key TEXT,
  p_attempt_id TEXT,
  p_user_id TEXT,
  p_subject TEXT,
  p_answer_hash TEXT,
  p_verdict TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing public.quiz_submissions%ROWTYPE;
BEGIN
  IF p_attempt_id IS NULL OR p_attempt_id !~ '^[A-Za-z0-9_-]{16,64}$'
     OR p_grade_key IS NULL OR p_grade_key !~ '^[A-Za-z0-9:_-]{16,160}$'
     OR NOT starts_with(p_grade_key, p_attempt_id || ':')
     OR char_length(p_grade_key) <= char_length(p_attempt_id) + 1
     OR p_subject IS NULL OR p_subject NOT IN ('webdev', 'geography', 'math', 'history', 'biology', 'chess', 'poker')
     OR p_answer_hash IS NULL OR p_answer_hash !~ '^[a-f0-9]{64}$'
     OR (p_user_id IS NOT NULL AND char_length(p_user_id) NOT BETWEEN 8 AND 128)
     OR p_verdict IS NULL OR p_verdict NOT IN ('correct', 'strike', 'void') THEN
    RAISE EXCEPTION 'invalid_challenge_answer';
  END IF;

  -- Serialize answers across instances and tabs, including the first answer
  -- of a run, when there is no existing row to lock.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('challenge-answer:' || p_attempt_id, 0));

  SELECT * INTO v_existing FROM public.quiz_submissions WHERE grade_key = p_grade_key;
  IF FOUND THEN
    IF v_existing.attempt_id = p_attempt_id
       AND v_existing.user_id IS NOT DISTINCT FROM p_user_id
       AND v_existing.subject = p_subject
       AND v_existing.answer_hash = p_answer_hash
       AND v_existing.challenge_verdict IS NOT NULL THEN
      RETURN jsonb_build_object('status', 'replay', 'verdict', v_existing.challenge_verdict);
    END IF;
    RETURN jsonb_build_object('status', 'conflict');
  END IF;

  IF (SELECT count(*) FROM public.quiz_submissions
       WHERE attempt_id = p_attempt_id AND challenge_verdict = 'strike') >= 3 THEN
    RETURN jsonb_build_object('status', 'finished');
  END IF;

  INSERT INTO public.quiz_submissions (grade_key, attempt_id, user_id, subject, answer_hash, challenge_verdict)
  VALUES (p_grade_key, p_attempt_id, p_user_id, p_subject, p_answer_hash, p_verdict)
  ON CONFLICT (grade_key) DO NOTHING;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'conflict');
  END IF;
  RETURN jsonb_build_object('status', 'claimed', 'verdict', p_verdict);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_challenge_answer(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_challenge_answer(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

COMMIT;
