-- Migration 074: serialize Classroom answers with Reveal, Next and Finish.
-- Apply after 073. Safe to re-run. Existing inserts use the same table and
-- columns, and multiplayer inserts keep their existing behavior.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF to_regprocedure('public.match_scoreboard(uuid,integer)') IS NULL THEN
    RAISE EXCEPTION 'migration 074 needs migration 056 first';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_classroom_answer_open_question()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' SET lock_timeout = '3s' AS $$
DECLARE
  v_status TEXT;
  v_current INTEGER;
  v_revealed INTEGER;
BEGIN
  -- Multiple pupils may hold a shared row lock together. A teacher's update
  -- takes the conflicting lock, so the open state and insert commit together.
  SELECT status, current_index, revealed_idx
    INTO v_status, v_current, v_revealed
    FROM public.matches
   WHERE id = NEW.match_id AND mode = 'classroom'
   FOR SHARE;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF v_status <> 'running' THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'bad_state';
  END IF;
  IF v_current <> NEW.question_idx THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'wrong_question';
  END IF;
  IF v_revealed = NEW.question_idx THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'question_closed';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_classroom_answer_open_question() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_classroom_answer_open_question() TO service_role;

DROP TRIGGER IF EXISTS classroom_answer_requires_open_question ON public.match_answers;
CREATE TRIGGER classroom_answer_requires_open_question
BEFORE INSERT ON public.match_answers
FOR EACH ROW EXECUTE FUNCTION public.guard_classroom_answer_open_question();

COMMIT;
