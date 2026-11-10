-- While a classroom room runs, its scoreboard counts only closed questions
-- (migration 056, owner decision 6 of 1 Oct 2026). match_scoreboard takes
-- p_before_idx and then counts only the answers to earlier questions;
-- api/play/[action].ts passes the current index, or the next one once the
-- teacher revealed the current question (matches.revealed_idx) or its clock
-- ran out. Without the argument it counts every answer, as before, which is
-- what a multiplayer room and a finished one get. A participant with nothing
-- counted keeps a row of zeros. The handler's refusal of an answer to a
-- revealed question is in scripts/test-play-rooms.ts.

SET LOCAL ROLE service_role;

DO $$
DECLARE
  v_host  CONSTANT TEXT := 'aaaaaaaa-0000-4000-8000-000000001901';
  v_ada   CONSTANT TEXT := 'aaaaaaaa-0000-4000-8000-000000001902';
  v_bo    CONSTANT TEXT := 'aaaaaaaa-0000-4000-8000-000000001903';
  v_match UUID;
  v_board TEXT;
  v_count INTEGER;
BEGIN
  INSERT INTO public.matches (code, mode, host_id, status, questions, current_index)
  VALUES ('CLOSE1', 'classroom', v_host, 'running', '[{"id":"q0"},{"id":"q1"},{"id":"q2"}]', 0)
  RETURNING id INTO v_match;
  INSERT INTO public.match_participants (match_id, user_id, display_name)
  VALUES (v_match, v_host, 'Teacher'), (v_match, v_ada, 'Ada'), (v_match, v_bo, 'Bo');
  -- Question 0 is closed: Ada right (bonus 40), Bo wrong. Question 1 is open:
  -- Bo has just answered it right (bonus 90), which would put him on top.
  INSERT INTO public.match_answers (match_id, user_id, question_id, question_idx, selected_idx, is_correct, duration_ms, speed_bonus)
  VALUES (v_match, v_ada, 'q0', 0, 1, TRUE, 3000, 40),
         (v_match, v_bo, 'q0', 0, 2, FALSE, 2000, 0);
  UPDATE public.matches SET current_index = 1 WHERE id = v_match;
  INSERT INTO public.match_answers (match_id, user_id, question_id, question_idx, selected_idx, is_correct, duration_ms, speed_bonus)
  VALUES (v_match, v_bo, 'q1', 1, 0, TRUE, 1000, 90);

  -- Every answer, as before 056: Bo leads on the open question.
  SELECT string_agg(format('%s:%s/%s', display_name, score, correct), ' ' ORDER BY score DESC, total_ms ASC)
    INTO v_board FROM public.match_scoreboard(v_match);
  ASSERT v_board = 'Bo:190/1 Ada:140/1 Teacher:0/0', format('without p_before_idx every answer counts: %s', v_board);

  -- The open question (1) is left out: Ada leads on what is closed.
  SELECT string_agg(format('%s:%s/%s/%s', display_name, score, correct, total_ms), ' ' ORDER BY score DESC, total_ms ASC)
    INTO v_board FROM public.match_scoreboard(v_match, 1);
  ASSERT v_board = 'Ada:140/1/3000 Teacher:0/0/0 Bo:0/0/2000',
    format('only the closed question counts, time included: %s', v_board);

  -- Nothing closed yet: everyone is there with zeros.
  SELECT count(*), max(score) INTO v_count, v_board FROM public.match_scoreboard(v_match, 0);
  ASSERT v_count = 3 AND v_board = '0', format('before the first close every participant has a zero row: %s rows, top %s', v_count, v_board);

  -- The teacher reveals question 1, which closes it: it counts now.
  UPDATE public.matches SET revealed_idx = 1 WHERE id = v_match;
  SELECT string_agg(format('%s:%s', display_name, score), ' ' ORDER BY score DESC, total_ms ASC)
    INTO v_board FROM public.match_scoreboard(v_match, 2);
  ASSERT v_board = 'Bo:190 Ada:140 Teacher:0', format('a closed question counts: %s', v_board);

  -- Another room's answers never reach this board.
  SELECT count(*) INTO v_count FROM public.match_scoreboard(gen_random_uuid(), 3);
  ASSERT v_count = 0, 'an unknown room has no rows';
END;
$$;

-- revealed_idx is the classroom's closed question: NULL until a reveal, never
-- negative.
DO $$
DECLARE
  v_nullable TEXT;
BEGIN
  SELECT is_nullable INTO v_nullable FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'matches' AND column_name = 'revealed_idx';
  ASSERT v_nullable = 'YES', format('revealed_idx exists and starts NULL, got %s', v_nullable);
  BEGIN
    INSERT INTO public.matches (code, mode, host_id, questions, revealed_idx)
    VALUES ('CLOSE2', 'classroom', 'aaaaaaaa-0000-4000-8000-000000001901', '[]', -1);
    ASSERT FALSE, 'a negative revealed_idx is refused';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$$;

-- One routine, for the server only: the one-argument version is gone, so a
-- call by name resolves to the new one, and the browser roles cannot run it.
RESET ROLE;
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM pg_proc WHERE proname = 'match_scoreboard' AND pronamespace = 'public'::regnamespace) = 1,
    'match_scoreboard has one signature';
  ASSERT NOT has_function_privilege('anon', 'public.match_scoreboard(uuid, integer)', 'EXECUTE'), 'anon cannot run it';
  ASSERT NOT has_function_privilege('authenticated', 'public.match_scoreboard(uuid, integer)', 'EXECUTE'), 'a learner cannot run it';
  ASSERT has_function_privilege('service_role', 'public.match_scoreboard(uuid, integer)', 'EXECUTE'), 'the server runs it';
END;
$$;
