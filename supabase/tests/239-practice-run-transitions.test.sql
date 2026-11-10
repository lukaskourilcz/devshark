SET LOCAL ROLE service_role;

DO $$
DECLARE
  v_user CONSTANT TEXT := 'practice-transition-239';
  v_other CONSTANT TEXT := 'practice-other-239';
  v_scheduled CONSTANT TEXT := 'practice239scheduled';
  v_new CONSTANT TEXT := 'practice239newactive';
  v_queue CONSTANT JSONB := '["js-double-numbers", "js-sum-array", "js-count-multiples"]';
  v_started TIMESTAMPTZ;
BEGIN
  ASSERT public.start_practice_session_v2(v_scheduled, v_user, 'webdev', 15, NULL, v_queue,
    'sequential', 3, NOW() + INTERVAL '1 day') = 'scheduled';
  ASSERT NOT public.begin_scheduled_practice_session(v_scheduled, v_other), 'only the owner can begin a run';
  ASSERT public.begin_scheduled_practice_session(v_scheduled, v_user), 'the owner can begin a scheduled run';
  SELECT started_at INTO v_started FROM public.practice_sessions WHERE session_id = v_scheduled;
  ASSERT public.begin_scheduled_practice_session(v_scheduled, v_user), 'begin can be retried after the response is lost';
  ASSERT (SELECT started_at FROM public.practice_sessions WHERE session_id = v_scheduled) = v_started,
    'retrying begin does not change the start time';

  PERFORM public.advance_practice_session(v_scheduled, v_user, 2, NULL);
  PERFORM public.advance_practice_session(v_scheduled, v_user, 1, NULL);
  PERFORM public.advance_practice_session(v_scheduled, v_other, 3, 'finished');
  ASSERT (SELECT position = 2 AND status = 'active' FROM public.practice_sessions WHERE session_id = v_scheduled),
    'late progress cannot move backwards and another learner cannot finish the run';

  PERFORM public.start_practice_session(v_new, v_user, 'webdev', 15, NULL, v_queue);
  PERFORM public.advance_practice_session(v_scheduled, v_user, 3, 'active');
  PERFORM public.advance_practice_session(v_scheduled, v_user, 3, 'finished');
  ASSERT NOT public.begin_scheduled_practice_session(v_scheduled, v_user), 'begin cannot revive a retired run';
  ASSERT public.start_practice_session_v2(v_scheduled, v_user, 'webdev', 15, NULL, v_queue, 'sequential', 3, NULL) = 'abandoned';
  PERFORM public.start_practice_session(v_scheduled, v_user, 'webdev', 15, NULL, v_queue);
  ASSERT (SELECT position = 2 AND status = 'abandoned' FROM public.practice_sessions WHERE session_id = v_scheduled),
    'an abandoned run keeps its terminal state and place';
  ASSERT (SELECT status = 'active' FROM public.practice_sessions WHERE session_id = v_new),
    'retrying an old start does not abandon its replacement';

  BEGIN
    PERFORM public.start_practice_session(v_new, v_other, 'webdev', 15, NULL, v_queue);
    ASSERT FALSE, 'another learner cannot claim an existing run id';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.practice_sessions (session_id, user_id, minutes, status)
    VALUES ('practice239duplicate', v_user, 15, 'scheduled');
    ASSERT FALSE, 'the table itself must reject two open runs for one learner';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  PERFORM public.advance_practice_session(v_new, v_user, 40, 'finished');
  PERFORM public.advance_practice_session(v_new, v_user, NULL, 'abandoned');
  ASSERT (SELECT position = 3 AND status = 'finished' FROM public.practice_sessions WHERE session_id = v_new),
    'finishing clamps the place and the first terminal transition wins';

  ASSERT public.start_practice_session_v2('practice239cancelled', v_user, 'webdev', 15, NULL, v_queue,
    'sequential', 3, NOW() + INTERVAL '1 day') = 'scheduled';
  PERFORM public.advance_practice_session('practice239cancelled', v_user, NULL, 'abandoned');
  ASSERT NOT public.begin_scheduled_practice_session('practice239cancelled', v_user), 'a canceled scheduled run stays closed';
END;
$$;

RESET ROLE;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

DO $$
DECLARE
  v_user CONSTANT TEXT := 'practice-start-race-239';
  v_a CONSTANT TEXT := 'practice239racinga';
  v_b CONSTANT TEXT := 'practice239racingb';
  v_dsn TEXT := format('host=%s port=%s dbname=%s user=%s password=%s',
    COALESCE(host(inet_server_addr()), 'localhost'), inet_server_port(), current_database(), current_user,
    COALESCE(NULLIF(current_setting('devshark.test_password', TRUE), ''), 'postgres'));
  v_pid_a INTEGER;
  v_pid_b INTEGER;
  v_waited BOOLEAN := FALSE;
  v_result TEXT;
  v_open TEXT[];
BEGIN
  PERFORM extensions.dblink_connect('practice_a', v_dsn);
  PERFORM extensions.dblink_connect('practice_b', v_dsn);
  PERFORM extensions.dblink_exec('practice_a', 'SET ROLE service_role');
  PERFORM extensions.dblink_exec('practice_b', 'SET ROLE service_role');
  SELECT pid INTO v_pid_a FROM extensions.dblink('practice_a', 'SELECT pg_backend_pid()') AS t(pid INTEGER);
  SELECT pid INTO v_pid_b FROM extensions.dblink('practice_b', 'SELECT pg_backend_pid()') AS t(pid INTEGER);

  -- No open row exists to lock. Race the old and new start routines.
  PERFORM extensions.dblink_exec('practice_a', 'BEGIN');
  PERFORM * FROM extensions.dblink('practice_a',
    format('SELECT public.start_practice_session(%L, %L, ''webdev'', 15, NULL, ''[]'')::TEXT', v_a, v_user)) AS t(r TEXT);
  PERFORM extensions.dblink_send_query('practice_b', format(
    'SELECT public.start_practice_session_v2(%L, %L, ''webdev'', 15, NULL, ''[]'', ''sequential'', NULL, NOW() + INTERVAL ''1 day'')',
    v_b, v_user));
  FOR i IN 1..100 LOOP
    v_waited := v_pid_a = ANY(pg_blocking_pids(v_pid_b));
    EXIT WHEN v_waited OR extensions.dblink_is_busy('practice_b') = 0;
    PERFORM pg_sleep(0.05);
  END LOOP;
  PERFORM extensions.dblink_exec('practice_a', 'COMMIT');
  SELECT r INTO v_result FROM extensions.dblink_get_result('practice_b') AS t(r TEXT);
  PERFORM * FROM extensions.dblink_get_result('practice_b') AS t(r TEXT);

  SELECT open_ids INTO v_open FROM extensions.dblink('practice_a', format(
    'SELECT ARRAY(SELECT session_id FROM public.practice_sessions WHERE user_id = %L AND status IN (''active'', ''scheduled'') ORDER BY session_id)', v_user)) AS t(open_ids TEXT[]);
  PERFORM extensions.dblink_exec('practice_a', format('DELETE FROM public.practice_sessions WHERE user_id = %L', v_user));
  PERFORM extensions.dblink_disconnect('practice_a');
  PERFORM extensions.dblink_disconnect('practice_b');
  ASSERT v_waited, 'starts through either routine wait on the same learner lock';
  ASSERT v_result = 'scheduled' AND v_open = ARRAY[v_b], 'only the replacement scheduled run remains open';
END;
$$;
