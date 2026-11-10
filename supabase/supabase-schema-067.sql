-- Migration 067: serialize practice-run starts and protect terminal states.
-- Apply after 066. Safe to re-run. The deployed code (838a0037) keeps all four
-- RPC signatures and grants, including advance with active after begin.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regprocedure('public.start_practice_session_v2(text,text,text,integer,text,jsonb,text,integer,timestamptz)') IS NULL
     OR to_regprocedure('public.accept_learning_path_quota_result(jsonb,jsonb,text,text,integer,text)') IS NULL THEN
    RAISE EXCEPTION 'migration 067 needs migrations 037 and 066 first';
  END IF;
END;
$$;

-- Keep the same newest run the API reads, breaking ties by session id.
-- Block writers between closing duplicates and creating the unique index.
LOCK TABLE public.practice_sessions IN SHARE ROW EXCLUSIVE MODE;
WITH open_runs AS (
  SELECT session_id,
         row_number() OVER (PARTITION BY user_id ORDER BY started_at DESC, session_id DESC) AS place
  FROM public.practice_sessions
  WHERE status IN ('active', 'scheduled')
)
UPDATE public.practice_sessions AS run
SET status = 'abandoned', updated_at = NOW()
FROM open_runs
WHERE run.session_id = open_runs.session_id AND open_runs.place > 1;

CREATE UNIQUE INDEX IF NOT EXISTS practice_sessions_one_open_per_user
  ON public.practice_sessions (user_id)
  WHERE status IN ('active', 'scheduled');

CREATE OR REPLACE FUNCTION public.start_practice_session_v2(
  p_session_id    TEXT,
  p_user_id       TEXT,
  p_subject       TEXT,
  p_minutes       INTEGER,
  p_topic         TEXT,
  p_queue         JSONB,
  p_order_mode    TEXT,
  p_task_count    INTEGER,
  p_scheduled_for TIMESTAMPTZ
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status TEXT;
  v_owner TEXT;
BEGIN
  -- A learner without an open run has no row to lock yet.
  PERFORM pg_advisory_xact_lock(hashtextextended('practice-session:' || p_user_id, 0));
  SELECT user_id, status INTO v_owner, v_status
  FROM public.practice_sessions
  WHERE session_id = p_session_id;
  IF FOUND THEN
    IF v_owner IS DISTINCT FROM p_user_id THEN
      RAISE unique_violation USING MESSAGE = 'Practice session id already exists';
    END IF;
    -- A retry of an earlier start must leave any replacement run alone.
    RETURN v_status;
  END IF;

  v_status := CASE WHEN p_scheduled_for > NOW() THEN 'scheduled' ELSE 'active' END;
  UPDATE public.practice_sessions
  SET status = 'abandoned', updated_at = NOW()
  WHERE user_id = p_user_id AND status IN ('active', 'scheduled');

  INSERT INTO public.practice_sessions
    (session_id, user_id, subject, minutes, topic, queue, status, order_mode, task_count, scheduled_for)
  VALUES
    (p_session_id, p_user_id, COALESCE(p_subject, 'webdev'), p_minutes, p_topic, COALESCE(p_queue, '[]'::jsonb),
     v_status, COALESCE(p_order_mode, 'sequential'), p_task_count,
     CASE WHEN v_status = 'scheduled' THEN p_scheduled_for END);
  RETURN v_status;
END;
$$;
REVOKE ALL ON FUNCTION public.start_practice_session_v2(TEXT, TEXT, TEXT, INTEGER, TEXT, JSONB, TEXT, INTEGER, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_practice_session_v2(TEXT, TEXT, TEXT, INTEGER, TEXT, JSONB, TEXT, INTEGER, TIMESTAMPTZ) TO service_role;

CREATE OR REPLACE FUNCTION public.start_practice_session(
  p_session_id TEXT,
  p_user_id    TEXT,
  p_subject    TEXT,
  p_minutes    INTEGER,
  p_topic      TEXT,
  p_queue      JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.start_practice_session_v2(p_session_id, p_user_id, p_subject, p_minutes, p_topic, p_queue,
    'sequential', NULL, NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.start_practice_session(TEXT, TEXT, TEXT, INTEGER, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_practice_session(TEXT, TEXT, TEXT, INTEGER, TEXT, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.begin_scheduled_practice_session(
  p_session_id TEXT,
  p_user_id    TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('practice-session:' || p_user_id, 0));
  UPDATE public.practice_sessions
  SET status = 'active', started_at = NOW(), updated_at = NOW()
  WHERE session_id = p_session_id AND user_id = p_user_id AND status = 'scheduled';
  IF FOUND THEN
    RETURN TRUE;
  END IF;

  -- The first begin may have committed even if its response never arrived.
  RETURN EXISTS (
    SELECT 1 FROM public.practice_sessions
    WHERE session_id = p_session_id AND user_id = p_user_id AND status = 'active' AND scheduled_for IS NOT NULL
  );
END;
$$;
REVOKE ALL ON FUNCTION public.begin_scheduled_practice_session(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_scheduled_practice_session(TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.advance_practice_session(
  p_session_id TEXT,
  p_user_id    TEXT,
  p_position   INTEGER,
  p_status     TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- The row lock rechecks this predicate after a concurrent replacement,
  -- completion or cancellation. An old advance can never reopen a row.
  UPDATE public.practice_sessions
  SET position = LEAST(GREATEST(COALESCE(p_position, position), position), jsonb_array_length(queue)),
      status = COALESCE(p_status, status),
      updated_at = NOW()
  WHERE session_id = p_session_id AND user_id = p_user_id
    AND ((status = 'active' AND (p_status IS NULL OR p_status IN ('active', 'finished', 'abandoned')))
      OR (status = 'scheduled' AND p_status = 'abandoned'));
END;
$$;
REVOKE ALL ON FUNCTION public.advance_practice_session(TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_practice_session(TEXT, TEXT, INTEGER, TEXT) TO service_role;

COMMIT;
