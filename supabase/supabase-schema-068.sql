-- Migration 068: record fully held Challenge completions as grading claims.
-- Apply after 067. Safe to re-run. Both deployed Challenge RPC signatures,
-- result shapes and grants stay in place. No existing rows are rewritten.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.practice_sessions_one_open_per_user') IS NULL
     OR to_regprocedure('public.record_challenge_completion_v2(text,text,text,integer,jsonb,jsonb)') IS NULL
     OR to_regprocedure('public.claim_quiz_submission(text,text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'migration 068 needs migrations 023, 060 and 067 first';
  END IF;
END;
$$;

-- The boolean fallback from 058, with a completion receipt for held XP.
CREATE OR REPLACE FUNCTION public.record_challenge_completion(
  p_user_id   TEXT,
  p_run_id    TEXT,
  p_subject   TEXT,
  p_xp        INTEGER,
  p_breakdown JSONB DEFAULT NULL,
  p_outcomes  JSONB DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today     DATE := (NOW() AT TIME ZONE 'UTC')::DATE;
  v_day_start TIMESTAMPTZ := (NOW() AT TIME ZONE 'UTC')::DATE::TIMESTAMP AT TIME ZONE 'UTC';
  v_counts    JSONB := '{}'::jsonb;
  v_seen_at   TIMESTAMPTZ;
  v_cut       INTEGER := 0;
  v_award     INTEGER;
  rec         RECORD;
BEGIN
  IF p_run_id IS NULL OR p_run_id !~ '^[A-Za-z0-9_-]{16,64}$' THEN
    RAISE EXCEPTION 'invalid_challenge_completion';
  END IF;
  IF p_xp IS NULL OR p_xp <= 0 THEN
    RETURN FALSE;
  END IF;

  -- 058: one learner's runs complete one at a time, so a run sent twice at
  -- once finds the first one's award below before it claims any question.
  PERFORM pg_advisory_xact_lock(hashtextextended('challenge-run:' || p_user_id, 0));

  -- A completed run changes nothing, even if it earned no XP.
  IF EXISTS (SELECT 1 FROM public.verified_activity_awards WHERE award_id = 'challenge:' || p_run_id)
     OR EXISTS (SELECT 1 FROM public.quiz_submissions WHERE grade_key = 'challenge-held:' || p_run_id) THEN
    RETURN FALSE;
  END IF;

  -- 058: a correct answer pays its XP only when its question last paid this
  -- account XP an hour ago or more. The API names each answer's XP in
  -- p_outcomes; an answer without one (the code before 058) is paid as before.
  IF p_outcomes IS NOT NULL AND jsonb_typeof(p_outcomes) = 'array' THEN
    FOR rec IN
      SELECT value->>'questionId' AS question_id,
             CASE WHEN jsonb_typeof(value->'isCorrect') = 'boolean'
                  THEN (value->>'isCorrect')::BOOLEAN END AS is_correct,
             CASE WHEN jsonb_typeof(value->'xp') = 'number' AND (value->>'xp') ~ '^[0-9]{1,5}$'
                  THEN (value->>'xp')::INTEGER END AS xp
        FROM jsonb_array_elements(p_outcomes)
       LIMIT 1000
    LOOP
      IF rec.question_id IS NULL OR rec.question_id !~ '^[A-Za-z0-9_-]{1,64}$' OR
         rec.is_correct IS NOT TRUE OR COALESCE(rec.xp, 0) = 0 THEN
        CONTINUE;
      END IF;
      IF NOT public.question_xp_claim(p_user_id, p_subject, rec.question_id) THEN
        v_cut := v_cut + rec.xp;
      END IF;
    END LOOP;
  END IF;
  v_award := p_xp - v_cut;
  -- Keep a receipt if every correct answer was held back, so a retry
  -- after cooldown cannot award this run. Grading claims already have
  -- account erasure and retention longer than the lifetime of a run token.
  IF v_award <= 0 THEN
    PERFORM public.claim_quiz_submission(
      'challenge-held:' || p_run_id, p_run_id, p_user_id, p_subject,
      encode(sha256(convert_to('challenge-xp-held', 'UTF8')), 'hex')
    );
    RETURN FALSE;
  END IF;

  -- The streak day, and the user_stats lock that makes one learner's writes
  -- apply one after the other, so the freshness read below sees what an
  -- earlier quiz or run wrote.
  PERFORM public.advance_verified_streak(p_user_id);

  -- Validates the user, the subject and the amount, and is the receipt.
  IF NOT public.record_verified_activity_xp(p_user_id, 'challenge:' || p_run_id, p_subject, v_award) THEN
    RETURN FALSE;
  END IF;

  IF p_outcomes IS NOT NULL AND jsonb_typeof(p_outcomes) = 'array' THEN
    FOR rec IN
      SELECT value->>'questionId' AS question_id,
             value->>'category' AS category,
             CASE WHEN jsonb_typeof(value->'isCorrect') = 'boolean'
                  THEN (value->>'isCorrect')::BOOLEAN END AS is_correct
        FROM jsonb_array_elements(p_outcomes)
       LIMIT 1000
    LOOP
      IF rec.question_id IS NULL OR rec.question_id !~ '^[A-Za-z0-9_-]{1,64}$' OR
         rec.category IS NULL OR rec.category !~ '^[a-z0-9-]{1,50}$' OR
         rec.is_correct IS NULL THEN
        CONTINUE;
      END IF;

      -- Fresh: never answered, or last answered before today (UTC).
      SELECT h.last_seen_at INTO v_seen_at
        FROM public.user_question_history h
       WHERE h.user_id = p_user_id AND h.subject = p_subject AND h.question_id = rec.question_id;
      IF NOT FOUND OR v_seen_at < v_day_start THEN
        v_counts := jsonb_set(
          v_counts,
          ARRAY[rec.category],
          jsonb_build_object(
            'correct', COALESCE((v_counts #>> ARRAY[rec.category, 'correct'])::INTEGER, 0)
                       + CASE WHEN rec.is_correct THEN 1 ELSE 0 END,
            'total',   COALESCE((v_counts #>> ARRAY[rec.category, 'total'])::INTEGER, 0) + 1
          ),
          TRUE
        );
      END IF;

      INSERT INTO public.user_question_history (
        user_id, question_id, subject, category, times_seen, times_missed,
        last_seen_at, last_missed_at
      ) VALUES (
        p_user_id, rec.question_id, p_subject, rec.category, 1,
        CASE WHEN rec.is_correct THEN 0 ELSE 1 END,
        NOW(), CASE WHEN rec.is_correct THEN NULL ELSE NOW() END
      )
      ON CONFLICT (user_id, subject, question_id) DO UPDATE SET
        category = EXCLUDED.category,
        times_seen = public.user_question_history.times_seen + 1,
        times_missed = public.user_question_history.times_missed +
          CASE WHEN rec.is_correct THEN 0 ELSE 1 END,
        last_seen_at = NOW(),
        last_missed_at = CASE
          WHEN rec.is_correct THEN public.user_question_history.last_missed_at
          ELSE NOW()
        END;
    END LOOP;

    FOR rec IN
      SELECT key AS category,
             (value->>'correct')::INTEGER AS correct,
             (value->>'total')::INTEGER AS total
        FROM jsonb_each(v_counts)
    LOOP
      PERFORM public.add_activity_day(p_user_id, v_today, rec.category, rec.correct, rec.total);
    END LOOP;
  ELSIF p_breakdown IS NOT NULL AND jsonb_typeof(p_breakdown) = 'object' THEN
    FOR rec IN
      SELECT key AS category,
             (value->>'correct')::INTEGER AS correct,
             (value->>'total')::INTEGER AS total
        FROM jsonb_each(p_breakdown)
       LIMIT 64
    LOOP
      PERFORM public.add_activity_day(p_user_id, v_today, rec.category, rec.correct, rec.total);
    END LOOP;
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.record_challenge_completion(TEXT, TEXT, TEXT, INTEGER, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_challenge_completion(TEXT, TEXT, TEXT, INTEGER, JSONB, JSONB)
  TO service_role;

-- The JSON wrapper from 060 keeps its first-completion XP details.
CREATE OR REPLACE FUNCTION public.record_challenge_completion_v2(
  p_user_id   TEXT,
  p_run_id    TEXT,
  p_subject   TEXT,
  p_xp        INTEGER,
  p_breakdown JSONB DEFAULT NULL,
  p_outcomes  JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_replay BOOLEAN;
  v_awarded BOOLEAN;
  v_award INTEGER := 0;
  v_held INTEGER := 0;
  v_until TIMESTAMPTZ;
BEGIN
  -- 058's per-learner run lock, taken before checking whether this is
  -- the first completion. Only the first returns held-answer details.
  PERFORM pg_advisory_xact_lock(hashtextextended('challenge-run:' || p_user_id, 0));
  v_replay := EXISTS (SELECT 1 FROM public.verified_activity_awards WHERE award_id = 'challenge:' || p_run_id)
    OR EXISTS (SELECT 1 FROM public.quiz_submissions WHERE grade_key = 'challenge-held:' || p_run_id);

  v_awarded := public.record_challenge_completion(p_user_id, p_run_id, p_subject, p_xp, p_breakdown, p_outcomes);
  IF v_awarded THEN
    SELECT xp INTO v_award FROM public.verified_activity_awards WHERE award_id = 'challenge:' || p_run_id;
  END IF;

  IF NOT v_replay AND COALESCE(p_xp, 0) > 0 AND p_outcomes IS NOT NULL AND jsonb_typeof(p_outcomes) = 'array' THEN
    SELECT COUNT(DISTINCT o.question_id)::INTEGER, MAX(q.last_xp_at) + INTERVAL '60 minutes'
      INTO v_held, v_until
      FROM (
        SELECT value->>'questionId' AS question_id,
               CASE WHEN jsonb_typeof(value->'isCorrect') = 'boolean'
                    THEN (value->>'isCorrect')::BOOLEAN END AS is_correct,
               CASE WHEN jsonb_typeof(value->'xp') = 'number' AND (value->>'xp') ~ '^[0-9]{1,5}$'
                    THEN (value->>'xp')::INTEGER END AS xp
          FROM jsonb_array_elements(p_outcomes)
         LIMIT 1000
      ) o
      JOIN public.user_question_xp q
        ON q.user_id = p_user_id AND q.subject = p_subject AND q.question_id = o.question_id
     WHERE o.question_id ~ '^[A-Za-z0-9_-]{1,64}$'
       AND o.is_correct IS TRUE AND COALESCE(o.xp, 0) > 0
       AND q.last_xp_at <> NOW()
       AND q.last_xp_at > NOW() - INTERVAL '60 minutes';
  END IF;
  RETURN jsonb_build_object(
    'awarded', v_awarded,
    'xp', COALESCE(v_award, 0),
    'xpHeld', CASE WHEN v_held > 0 THEN jsonb_build_object('questions', v_held, 'availableAt', v_until) END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.record_challenge_completion_v2(TEXT, TEXT, TEXT, INTEGER, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_challenge_completion_v2(TEXT, TEXT, TEXT, INTEGER, JSONB, JSONB)
  TO service_role;

COMMIT;
