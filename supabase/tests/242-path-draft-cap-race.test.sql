-- Two first saves on different activities compete for the last draft slot.
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

DO $$
DECLARE
  v_user CONSTANT TEXT := 'aaaaaaaa-0000-4000-8000-000000002421';
  v_enrollment CONSTANT TEXT := 'draft-race-enroll-242';
  v_dsn TEXT := format('host=%s port=%s dbname=%s user=%s password=%s',
    COALESCE(host(inet_server_addr()), 'localhost'), inet_server_port(), current_database(), current_user,
    COALESCE(NULLIF(current_setting('devshark.test_password', TRUE), ''), 'postgres'));
  v_save CONSTANT TEXT := 'SELECT public.save_learning_path_draft_v2(%L, %L, %L, 0, ''{"code":"draft"}'', 1)::TEXT';
  v_first JSONB;
  v_second JSONB;
  v_count INTEGER;
  v_pid INTEGER;
  v_waited BOOLEAN := FALSE;
BEGIN
  PERFORM extensions.dblink_connect('draft_race_a', v_dsn);
  PERFORM extensions.dblink_connect('draft_race_b', v_dsn);
  SELECT pid INTO v_pid FROM extensions.dblink('draft_race_b', 'SELECT pg_backend_pid()') AS t(pid INTEGER);
  PERFORM * FROM extensions.dblink('draft_race_a',
    format('SELECT public.upsert_learning_path_enrollment(%L, %L, ''fde'', 1, NULL, ''enroll'')::TEXT', v_user, v_enrollment)) AS t(r TEXT);

  PERFORM extensions.dblink_exec('draft_race_a', 'BEGIN');
  SELECT r::JSONB INTO v_first FROM extensions.dblink('draft_race_a',
    format(v_save, v_user, v_enrollment, 'first-activity')) AS t(r TEXT);
  PERFORM extensions.dblink_send_query('draft_race_b',
    format(v_save, v_user, v_enrollment, 'second-activity'));
  FOR i IN 1..80 LOOP
    PERFORM pg_stat_clear_snapshot();
    SELECT wait_event_type = 'Lock' INTO v_waited FROM pg_stat_activity WHERE pid = v_pid;
    EXIT WHEN v_waited OR extensions.dblink_is_busy('draft_race_b') = 0;
    PERFORM pg_sleep(0.02);
  END LOOP;
  PERFORM extensions.dblink_exec('draft_race_a', 'COMMIT');
  SELECT r::JSONB INTO v_second FROM extensions.dblink_get_result('draft_race_b') AS t(r TEXT);
  PERFORM * FROM extensions.dblink_get_result('draft_race_b') AS t(r TEXT);
  SELECT n INTO v_count FROM extensions.dblink('draft_race_a',
    format('SELECT count(*)::int FROM public.learning_path_drafts WHERE enrollment_id = %L', v_enrollment)) AS t(n INTEGER);
  PERFORM * FROM extensions.dblink('draft_race_a', format('SELECT public.delete_user_data(%L)::TEXT', v_user)) AS t(r TEXT);
  PERFORM extensions.dblink_disconnect('draft_race_a');
  PERFORM extensions.dblink_disconnect('draft_race_b');

  ASSERT (v_first ->> 'ok')::BOOLEAN, format('the first save did not succeed: %s', v_first);
  ASSERT v_count = 1, format('the draft cap of one stored %s rows', v_count);
  ASSERT v_waited AND v_second ->> 'reason' = 'too_many_drafts',
    format('the second save did not wait and respect the cap: %s', v_second);
END;
$$;
