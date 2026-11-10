CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

DO $$
DECLARE
  v_match UUID := gen_random_uuid();
  v_host TEXT := gen_random_uuid()::TEXT;
  v_first TEXT := gen_random_uuid()::TEXT;
  v_second TEXT := gen_random_uuid()::TEXT;
  v_dsn TEXT := format('host=%s port=%s dbname=%s user=%s password=%s',
    COALESCE(host(inet_server_addr()), 'localhost'), inet_server_port(), current_database(), current_user,
    COALESCE(NULLIF(current_setting('devshark.test_password', TRUE), ''), 'postgres'));
  v_pid INTEGER;
  v_closed RECORD;
  v_waited BOOLEAN;
  v_result INTEGER;
  v_error TEXT;
  v_count INTEGER;
  v_failures TEXT[] := '{}';
  v_first_insert TEXT := format(
    'INSERT INTO public.match_answers (match_id, user_id, question_id, question_idx, selected_idx, is_correct)
     VALUES (%L, %L, ''q0'', 0, 0, TRUE) RETURNING question_idx', v_match, v_first);
  v_second_insert TEXT := format(
    'INSERT INTO public.match_answers (match_id, user_id, question_id, question_idx, selected_idx, is_correct)
     VALUES (%L, %L, ''q0'', 0, 0, TRUE) RETURNING question_idx', v_match, v_second);
BEGIN
  PERFORM extensions.dblink_connect('classroom_closure_a', v_dsn);
  PERFORM extensions.dblink_connect('classroom_closure_b', v_dsn);
  SELECT pid INTO v_pid FROM extensions.dblink('classroom_closure_b', 'SELECT pg_backend_pid()') AS t(pid INTEGER);
  PERFORM extensions.dblink_exec('classroom_closure_a', 'SET ROLE service_role');
  PERFORM extensions.dblink_exec('classroom_closure_b', 'SET ROLE service_role');
  PERFORM extensions.dblink_exec('classroom_closure_a', format(
    'INSERT INTO public.matches (id, code, mode, host_id, status, questions, question_duration_s)
     VALUES (%L, %L, ''classroom'', %L, ''running'', ''[{"id":"q0"},{"id":"q1"}]'', 0)',
    v_match, left(v_match::TEXT, 12), v_host));

  -- The API read an open question, then Reveal, Next or Finish got the
  -- write lock before the answer. The insert must wait and see the new row.
  FOR v_closed IN SELECT * FROM (VALUES
    ('revealed_idx = 0', 'question_closed'),
    ('current_index = 1', 'wrong_question'),
    ('status = ''finished''', 'bad_state')
  ) AS changes(patch, reason)
  LOOP
    PERFORM extensions.dblink_exec('classroom_closure_a', 'BEGIN');
    PERFORM extensions.dblink_exec('classroom_closure_a', format(
      'UPDATE public.matches SET %s WHERE id = %L', v_closed.patch, v_match));
    PERFORM extensions.dblink_send_query('classroom_closure_b', v_first_insert);
    v_waited := FALSE;
    FOR i IN 1..80 LOOP
      PERFORM pg_stat_clear_snapshot();
      SELECT wait_event_type = 'Lock' INTO v_waited FROM pg_stat_activity WHERE pid = v_pid;
      EXIT WHEN v_waited OR extensions.dblink_is_busy('classroom_closure_b') = 0;
      PERFORM pg_sleep(0.02);
    END LOOP;
    PERFORM extensions.dblink_exec('classroom_closure_a', 'COMMIT');
    SELECT question_idx INTO v_result FROM extensions.dblink_get_result('classroom_closure_b', FALSE) AS t(question_idx INTEGER);
    v_error := extensions.dblink_error_message('classroom_closure_b');
    PERFORM * FROM extensions.dblink_get_result('classroom_closure_b', FALSE) AS t(question_idx INTEGER);
    SELECT n INTO v_count FROM extensions.dblink('classroom_closure_a', format(
      'SELECT count(*)::INT FROM public.match_answers WHERE match_id = %L', v_match)) AS t(n INTEGER);
    IF v_waited IS DISTINCT FROM TRUE OR v_result IS NOT NULL OR v_error NOT LIKE '%' || v_closed.reason || '%' OR v_count <> 0 THEN
      v_failures := array_append(v_failures, format('%s: waited=%s result=%s error=%s answers=%s',
        v_closed.reason, v_waited, v_result, v_error, v_count));
    END IF;
    PERFORM extensions.dblink_exec('classroom_closure_a', format('DELETE FROM public.match_answers WHERE match_id = %L', v_match));
    PERFORM extensions.dblink_exec('classroom_closure_a', format(
      'UPDATE public.matches SET status = ''running'', current_index = 0, revealed_idx = NULL WHERE id = %L', v_match));
  END LOOP;

  -- Two pupils may answer simultaneously. A closing update must still wait
  -- for the first pupil's uncommitted answer before exposing the score.
  PERFORM extensions.dblink_exec('classroom_closure_a', 'BEGIN');
  PERFORM * FROM extensions.dblink('classroom_closure_a', v_first_insert) AS t(question_idx INTEGER);
  SELECT question_idx INTO v_result FROM extensions.dblink('classroom_closure_b', v_second_insert, FALSE) AS t(question_idx INTEGER);
  IF v_result IS DISTINCT FROM 0 THEN
    v_failures := array_append(v_failures, 'another pupil was unable to answer during an open answer transaction');
  END IF;
  PERFORM extensions.dblink_send_query('classroom_closure_b', format(
    'UPDATE public.matches SET current_index = 1 WHERE id = %L RETURNING current_index', v_match));
  v_waited := FALSE;
  FOR i IN 1..80 LOOP
    PERFORM pg_stat_clear_snapshot();
    SELECT wait_event_type = 'Lock' INTO v_waited FROM pg_stat_activity WHERE pid = v_pid;
    EXIT WHEN v_waited OR extensions.dblink_is_busy('classroom_closure_b') = 0;
    PERFORM pg_sleep(0.02);
  END LOOP;
  PERFORM extensions.dblink_exec('classroom_closure_a', 'COMMIT');
  SELECT current_index INTO v_result FROM extensions.dblink_get_result('classroom_closure_b', FALSE) AS t(current_index INTEGER);
  PERFORM * FROM extensions.dblink_get_result('classroom_closure_b', FALSE) AS t(current_index INTEGER);
  SELECT n INTO v_count FROM extensions.dblink('classroom_closure_a', format(
    'SELECT count(*)::INT FROM public.match_answers WHERE match_id = %L', v_match)) AS t(n INTEGER);
  IF v_waited IS DISTINCT FROM TRUE OR v_result IS DISTINCT FROM 1 OR v_count <> 2 THEN
    v_failures := array_append(v_failures, format('answers first: waited=%s current_index=%s answers=%s',
      v_waited, v_result, v_count));
  END IF;

  PERFORM extensions.dblink_exec('classroom_closure_a', format('DELETE FROM public.matches WHERE id = %L', v_match));
  PERFORM extensions.dblink_disconnect('classroom_closure_a');
  PERFORM extensions.dblink_disconnect('classroom_closure_b');
  ASSERT cardinality(v_failures) = 0, array_to_string(v_failures, '; ');
END;
$$;
