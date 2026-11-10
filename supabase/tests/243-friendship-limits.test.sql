-- Two requests for the same account must wait for the first transaction,
-- even when there is no friendship row yet or the requests target different people.
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

DO $$
DECLARE
  v_tag TEXT := 'fr' || left(replace(gen_random_uuid()::TEXT, '-', ''), 14);
  v_sender TEXT := v_tag || 'a';
  v_first TEXT := v_tag || 'b';
  v_second TEXT := v_tag || 'c';
  v_dsn TEXT := format('host=%s port=%s dbname=%s user=%s password=%s',
    COALESCE(host(inet_server_addr()), 'localhost'), inet_server_port(), current_database(), current_user,
    COALESCE(NULLIF(current_setting('devshark.test_password', TRUE), ''), 'postgres'));
  v_pid INTEGER;
  v_waited BOOLEAN;
  v_duplicate TEXT;
  v_distinct TEXT;
  v_error TEXT;
  v_pending INTEGER;
BEGIN
  PERFORM extensions.dblink_connect('friend_race_a', v_dsn);
  PERFORM extensions.dblink_connect('friend_race_b', v_dsn);
  SELECT pid INTO v_pid FROM extensions.dblink('friend_race_b', 'SELECT pg_backend_pid()') AS t(pid INTEGER);
  -- These fixture handles are only lookup labels. Do not spend real test
  -- counter ordinals in the remotely committed setup transaction.
  PERFORM extensions.dblink_exec('friend_race_a', 'SET session_replication_role = replica');
  PERFORM extensions.dblink_exec('friend_race_a', format(
    'INSERT INTO public.user_handles (user_id, handle) VALUES (%L, %L), (%L, %L)',
    v_first, v_first, v_second, v_second));
  PERFORM extensions.dblink_exec('friend_race_a', 'RESET session_replication_role');
  PERFORM extensions.dblink_exec('friend_race_a', format(
    'INSERT INTO public.friendships (user_low, user_high, requested_by, state)
     SELECT %L, %L || n, %L, ''pending'' FROM generate_series(1, 49) n',
    v_sender, v_tag || 'z', v_sender));

  PERFORM extensions.dblink_exec('friend_race_a', 'BEGIN');
  PERFORM * FROM extensions.dblink('friend_race_a', format('SELECT public.request_friend(%L, %L)', v_sender, v_first)) AS t(state TEXT);
  PERFORM extensions.dblink_send_query('friend_race_b', format('SELECT public.request_friend(%L, %L)', v_sender, v_first));
  FOR i IN 1..80 LOOP
    PERFORM pg_stat_clear_snapshot();
    SELECT wait_event_type = 'Lock' INTO v_waited FROM pg_stat_activity WHERE pid = v_pid;
    EXIT WHEN v_waited OR extensions.dblink_is_busy('friend_race_b') = 0;
    PERFORM pg_sleep(0.02);
  END LOOP;
  PERFORM extensions.dblink_exec('friend_race_a', 'COMMIT');
  SELECT state INTO v_duplicate FROM extensions.dblink_get_result('friend_race_b', FALSE) AS t(state TEXT);
  PERFORM * FROM extensions.dblink_get_result('friend_race_b', FALSE) AS t(state TEXT);

  PERFORM extensions.dblink_exec('friend_race_a', format(
    'DELETE FROM public.friendships WHERE user_low = %L AND user_high = %L', v_sender, v_first));
  PERFORM extensions.dblink_exec('friend_race_a', 'BEGIN');
  PERFORM * FROM extensions.dblink('friend_race_a', format('SELECT public.request_friend(%L, %L)', v_sender, v_first)) AS t(state TEXT);
  PERFORM extensions.dblink_send_query('friend_race_b', format('SELECT public.request_friend(%L, %L)', v_sender, v_second));
  v_waited := FALSE;
  FOR i IN 1..80 LOOP
    PERFORM pg_stat_clear_snapshot();
    SELECT wait_event_type = 'Lock' INTO v_waited FROM pg_stat_activity WHERE pid = v_pid;
    EXIT WHEN v_waited OR extensions.dblink_is_busy('friend_race_b') = 0;
    PERFORM pg_sleep(0.02);
  END LOOP;
  PERFORM extensions.dblink_exec('friend_race_a', 'COMMIT');
  SELECT state INTO v_distinct FROM extensions.dblink_get_result('friend_race_b', FALSE) AS t(state TEXT);
  v_error := extensions.dblink_error_message('friend_race_b');
  PERFORM * FROM extensions.dblink_get_result('friend_race_b', FALSE) AS t(state TEXT);
  SELECT n INTO v_pending FROM extensions.dblink('friend_race_a', format(
    'SELECT count(*)::INT FROM public.friendships WHERE requested_by = %L AND state = ''pending''', v_sender)) AS t(n INTEGER);
  PERFORM extensions.dblink_exec('friend_race_a', format('DELETE FROM public.friendships WHERE requested_by = %L', v_sender));
  PERFORM extensions.dblink_exec('friend_race_a', format('DELETE FROM public.user_handles WHERE user_id IN (%L, %L)', v_first, v_second));
  PERFORM extensions.dblink_disconnect('friend_race_a');
  PERFORM extensions.dblink_disconnect('friend_race_b');

  ASSERT v_duplicate IS NOT DISTINCT FROM 'pending', 'the concurrent duplicate replays the original request';
  ASSERT v_waited AND v_distinct IS NULL AND v_error LIKE '%pending_limit_reached%' AND v_pending = 50,
    format('the second destination did not wait and respect the outgoing limit: %s / %s / %s', v_waited, v_error, v_pending);
END;
$$;

SET LOCAL ROLE service_role;

DO $$
DECLARE
  v_sender CONSTANT TEXT := 'friend243-sender';
  v_receiver CONSTANT TEXT := 'friend243-receiver';
  v_error TEXT;
BEGIN
  PERFORM public.set_user_handle(v_sender, v_sender);
  PERFORM public.set_user_handle(v_receiver, v_receiver);
  PERFORM public.request_friend(v_sender, v_receiver);

  -- The sender reached the cap since sending this request. The receiver is
  -- still under the limit, whether accepting directly or by asking back.
  INSERT INTO public.friendships (user_low, user_high, requested_by, state)
  SELECT v_sender, 'friend243-z' || n, v_sender, 'accepted' FROM generate_series(1, 200) n;

  BEGIN
    PERFORM public.respond_friend(v_receiver, v_sender, TRUE);
  EXCEPTION WHEN raise_exception THEN v_error := SQLERRM;
  END;
  ASSERT v_error IS NOT DISTINCT FROM 'friend_limit_reached', 'acceptance checks the sender capacity';
  v_error := NULL;
  BEGIN
    PERFORM public.request_friend(v_receiver, v_sender);
  EXCEPTION WHEN raise_exception THEN v_error := SQLERRM;
  END;
  ASSERT v_error IS NOT DISTINCT FROM 'friend_limit_reached', 'a reciprocal request checks the sender capacity';

  PERFORM public.remove_friend(v_receiver, v_sender, TRUE);
  v_error := NULL;
  BEGIN
    PERFORM public.request_friend(v_sender, v_receiver);
  EXCEPTION WHEN raise_exception THEN v_error := SQLERRM;
  END;
  ASSERT v_error IS NOT DISTINCT FROM 'friend_limit_reached', 'a full sender gets the ordinary limit even when blocked';
  DELETE FROM public.friendships WHERE user_low = v_sender AND user_high = 'friend243-z200';
  ASSERT public.request_friend(v_sender, v_receiver) = 'pending', 'the blocked request still looks sent below the limit';
  ASSERT EXISTS (SELECT 1 FROM public.friendships WHERE user_low = v_receiver AND user_high = v_sender AND blocked_by = v_receiver),
    'the apparent pending request does not replace the block';
  ASSERT NOT has_function_privilege('authenticated', 'public.request_friend(text,text)', 'EXECUTE'), 'direct request access stays private';
END;
$$;
