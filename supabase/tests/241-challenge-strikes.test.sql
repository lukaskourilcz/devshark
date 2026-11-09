SET LOCAL ROLE service_role;

DO $$
DECLARE
  v_run CONSTANT TEXT := 'challenge-strikes-241';
  v_user CONSTANT TEXT := 'challenge-learner-241';
  v_hash CONSTANT TEXT := repeat('a', 64);
BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.claim_challenge_answer(text,text,text,text,text,text)', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'public.claim_challenge_answer(text,text,text,text,text,text)', 'EXECUTE');
  ASSERT public.claim_challenge_answer(v_run || ':right', v_run, v_user, 'webdev', v_hash, 'correct') = '{"status":"claimed","verdict":"correct"}'::JSONB;
  ASSERT public.claim_challenge_answer(v_run || ':first', v_run, v_user, 'webdev', v_hash, 'strike') = '{"status":"claimed","verdict":"strike"}'::JSONB;
  ASSERT public.claim_challenge_answer(v_run || ':second', v_run, v_user, 'webdev', v_hash, 'strike') = '{"status":"claimed","verdict":"strike"}'::JSONB;
  ASSERT public.claim_challenge_answer(v_run || ':retired', v_run, v_user, 'webdev', v_hash, 'void') = '{"status":"claimed","verdict":"void"}'::JSONB;
  ASSERT public.claim_challenge_answer(v_run || ':retired', v_run, v_user, 'webdev', v_hash, 'correct') = '{"status":"replay","verdict":"void"}'::JSONB;
  ASSERT public.claim_challenge_answer(v_run || ':third', v_run, v_user, 'webdev', v_hash, 'strike') = '{"status":"claimed","verdict":"strike"}'::JSONB;
  ASSERT public.claim_challenge_answer(v_run || ':late', v_run, v_user, 'webdev', v_hash, 'correct') = '{"status":"finished"}'::JSONB;
  ASSERT public.claim_challenge_answer(v_run || ':right', v_run, v_user, 'webdev', v_hash, 'void') = '{"status":"replay","verdict":"correct"}'::JSONB;
  ASSERT public.claim_challenge_answer(v_run || ':third', v_run, v_user, 'webdev', v_hash, 'strike') = '{"status":"replay","verdict":"strike"}'::JSONB;
  ASSERT public.claim_challenge_answer(v_run || ':third', v_run, v_user, 'webdev', repeat('b', 64), 'correct') = '{"status":"conflict"}'::JSONB;
  ASSERT public.claim_challenge_answer(v_run || ':third', v_run, 'other-learner-241', 'webdev', v_hash, 'strike') = '{"status":"conflict"}'::JSONB;
  ASSERT (SELECT count(*) FROM public.quiz_submissions WHERE attempt_id = v_run) = 5;

  ASSERT public.claim_quiz_submission('legacy-challenge-241:first', 'legacy-challenge-241', NULL, 'webdev', v_hash) = 'claimed';
  ASSERT public.claim_quiz_submission('legacy-challenge-241:first', 'legacy-challenge-241', NULL, 'webdev', v_hash) = 'replay';
END;
$$;

RESET ROLE;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

DO $$
DECLARE
  v_run CONSTANT TEXT := 'challenge-race-241';
  v_dsn TEXT := format('host=%s port=%s dbname=%s user=%s password=%s',
    COALESCE(host(inet_server_addr()), 'localhost'), inet_server_port(), current_database(), current_user,
    COALESCE(NULLIF(current_setting('devshark.test_password', TRUE), ''), 'postgres'));
  v_pid_a INTEGER;
  v_pid_b INTEGER;
  v_waited BOOLEAN := FALSE;
  v_result JSONB;
BEGIN
  PERFORM extensions.dblink_connect('challenge_a', v_dsn);
  PERFORM extensions.dblink_connect('challenge_b', v_dsn);
  PERFORM extensions.dblink_exec('challenge_a', 'SET ROLE service_role');
  PERFORM extensions.dblink_exec('challenge_b', 'SET ROLE service_role');
  SELECT pid INTO v_pid_a FROM extensions.dblink('challenge_a', 'SELECT pg_backend_pid()') AS t(pid INTEGER);
  SELECT pid INTO v_pid_b FROM extensions.dblink('challenge_b', 'SELECT pg_backend_pid()') AS t(pid INTEGER);

  -- Hold the third strike uncommitted while a correct answer for the same
  -- run arrives. It must wait, see the committed strike and be refused.
  PERFORM extensions.dblink_exec('challenge_a', 'BEGIN');
  FOR i IN 1..3 LOOP
    PERFORM * FROM extensions.dblink('challenge_a', format(
      'SELECT public.claim_challenge_answer(%L, %L, NULL, ''webdev'', repeat(''a'', 64), ''strike'')',
      v_run || ':' || i, v_run)) AS t(result JSONB);
  END LOOP;
  PERFORM extensions.dblink_send_query('challenge_b', format(
    'SELECT public.claim_challenge_answer(%L, %L, NULL, ''webdev'', repeat(''a'', 64), ''correct'')', v_run || ':late', v_run));
  FOR i IN 1..100 LOOP
    v_waited := v_pid_a = ANY(pg_blocking_pids(v_pid_b));
    EXIT WHEN v_waited OR extensions.dblink_is_busy('challenge_b') = 0;
    PERFORM pg_sleep(0.05);
  END LOOP;
  PERFORM extensions.dblink_exec('challenge_a', 'COMMIT');
  SELECT result INTO v_result FROM extensions.dblink_get_result('challenge_b') AS t(result JSONB);
  PERFORM * FROM extensions.dblink_get_result('challenge_b') AS t(result JSONB);
  PERFORM extensions.dblink_exec('challenge_a', format('DELETE FROM public.quiz_submissions WHERE attempt_id = %L', v_run));
  PERFORM extensions.dblink_disconnect('challenge_a');
  PERFORM extensions.dblink_disconnect('challenge_b');
  ASSERT v_waited, 'another answer waits on the same run lock';
  ASSERT v_result = '{"status":"finished"}'::JSONB, 'the third strike closes the run before another answer can score';
END;
$$;
