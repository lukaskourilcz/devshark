-- A card write and deletion of its Auth owner must be serialized, even
-- though the service role bypasses the browser's table policies.
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

DO $$
DECLARE
  v_user UUID := gen_random_uuid();
  v_dsn TEXT := format('host=%s port=%s dbname=%s user=%s password=%s',
    COALESCE(host(inet_server_addr()), 'localhost'), inet_server_port(), current_database(), current_user,
    COALESCE(NULLIF(current_setting('devshark.test_password', TRUE), ''), 'postgres'));
  v_write TEXT := format('INSERT INTO public.flashcards(user_id, question_id, question, correct_answer)
    VALUES (%L, ''flashcard-race-fixture'', ''Synthetic question'', ''Synthetic answer'')
    ON CONFLICT (user_id, question_id) DO UPDATE SET question = EXCLUDED.question', v_user);
  v_pid INTEGER;
  v_waited BOOLEAN := FALSE;
  v_deleted UUID;
  v_late TEXT;
  v_error TEXT;
  v_count INTEGER;
BEGIN
  PERFORM extensions.dblink_connect('card_erase_a', v_dsn);
  PERFORM extensions.dblink_connect('card_erase_b', v_dsn);
  SELECT pid INTO v_pid FROM extensions.dblink('card_erase_b', 'SELECT pg_backend_pid()') AS t(pid INTEGER);
  PERFORM extensions.dblink_exec('card_erase_b', format('INSERT INTO auth.users(id) VALUES (%L)', v_user));

  PERFORM extensions.dblink_exec('card_erase_a', 'SET ROLE service_role');
  PERFORM extensions.dblink_exec('card_erase_a', 'BEGIN');
  PERFORM extensions.dblink_exec('card_erase_a', v_write);
  PERFORM extensions.dblink_send_query('card_erase_b', format('DELETE FROM auth.users WHERE id = %L RETURNING id', v_user));
  FOR i IN 1..80 LOOP
    PERFORM pg_stat_clear_snapshot();
    SELECT wait_event_type = 'Lock' INTO v_waited FROM pg_stat_activity WHERE pid = v_pid;
    EXIT WHEN v_waited OR extensions.dblink_is_busy('card_erase_b') = 0;
    PERFORM pg_sleep(0.02);
  END LOOP;
  PERFORM extensions.dblink_exec('card_erase_a', 'COMMIT');
  SELECT id INTO v_deleted FROM extensions.dblink_get_result('card_erase_b') AS t(id UUID);
  PERFORM * FROM extensions.dblink_get_result('card_erase_b') AS t(id UUID);
  PERFORM * FROM extensions.dblink('card_erase_b', format('SELECT public.delete_user_data(%L)::TEXT', v_user)) AS t(outcome TEXT);

  -- A service request authenticated before deletion can reach its write after
  -- the final cleanup. The table itself must refuse it then.
  v_late := extensions.dblink_exec('card_erase_a', v_write, FALSE);
  v_error := extensions.dblink_error_message('card_erase_a');
  SELECT n INTO v_count FROM extensions.dblink('card_erase_b', format(
    'SELECT count(*)::INT FROM public.flashcards WHERE user_id = %L', v_user)) AS t(n INTEGER);
  PERFORM extensions.dblink_exec('card_erase_b', format('DELETE FROM public.flashcards WHERE user_id = %L', v_user));
  PERFORM extensions.dblink_disconnect('card_erase_a');
  PERFORM extensions.dblink_disconnect('card_erase_b');

  ASSERT v_late = 'ERROR' AND v_error LIKE '%flashcard_account_missing%' AND v_count = 0,
    format('an authenticated-in-flight writer recreated an erased card: %s / %s / %s', v_late, v_error, v_count);
  ASSERT v_waited AND v_deleted = v_user, 'deletion waits for a writer holding the owner row before final cleanup';
  ASSERT NOT has_function_privilege('authenticated', 'public.guard_flashcard_account()', 'EXECUTE'), 'the browser cannot call the account guard';
END;
$$;
