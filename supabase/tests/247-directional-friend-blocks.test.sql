-- Hold a new block open in one connection as another submits a request.
-- Once the block commits, the other transaction can add only a muted row.
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

DO $$
DECLARE
  v_blocker TEXT := gen_random_uuid()::TEXT;
  v_sender TEXT := gen_random_uuid()::TEXT;
  v_blocker_handle TEXT := 'blocker247-' || left(v_blocker, 8);
  v_sender_handle TEXT := 'sender247-' || left(v_sender, 8);
  v_dsn TEXT := format('host=%s port=%s dbname=%s user=%s password=%s',
    COALESCE(host(inet_server_addr()), 'localhost'), inet_server_port(), current_database(), current_user,
    COALESCE(NULLIF(current_setting('devshark.test_password', TRUE), ''), 'postgres'));
  v_pid INTEGER;
  v_waited BOOLEAN := FALSE;
  v_result TEXT;
  v_incoming INTEGER;
  v_outgoing INTEGER;
BEGIN
  PERFORM extensions.dblink_connect('friend_block_a', v_dsn);
  PERFORM extensions.dblink_connect('friend_block_b', v_dsn);
  SELECT pid INTO v_pid FROM extensions.dblink('friend_block_b', 'SELECT pg_backend_pid()') AS t(pid INTEGER);
  PERFORM extensions.dblink_exec('friend_block_a', format(
    'INSERT INTO public.user_handles(user_id, handle) VALUES (%L, %L), (%L, %L)',
    v_blocker, v_blocker_handle, v_sender, v_sender_handle));
  PERFORM extensions.dblink_exec('friend_block_a', 'BEGIN');
  PERFORM * FROM extensions.dblink('friend_block_a', format(
    'SELECT public.remove_friend(%L, %L, TRUE)', v_blocker, v_sender_handle)) AS t(done BOOLEAN);
  PERFORM extensions.dblink_send_query('friend_block_b', format(
    'SELECT public.request_friend(%L, %L)', v_sender, v_blocker_handle));
  FOR i IN 1..80 LOOP
    PERFORM pg_stat_clear_snapshot();
    SELECT wait_event_type = 'Lock' INTO v_waited FROM pg_stat_activity WHERE pid = v_pid;
    EXIT WHEN v_waited OR extensions.dblink_is_busy('friend_block_b') = 0;
    PERFORM pg_sleep(0.02);
  END LOOP;
  PERFORM extensions.dblink_exec('friend_block_a', 'COMMIT');
  SELECT result INTO v_result FROM extensions.dblink_get_result('friend_block_b') AS t(result TEXT);
  PERFORM * FROM extensions.dblink_get_result('friend_block_b') AS t(result TEXT);
  SELECT incoming, outgoing INTO v_incoming, v_outgoing FROM extensions.dblink('friend_block_a', format(
    'SELECT (SELECT count(*)::INT FROM public.friend_requests(%L)),
            (SELECT count(*)::INT FROM public.friend_requests(%L) WHERE direction = ''outgoing'')',
    v_blocker, v_sender)) AS t(incoming INTEGER, outgoing INTEGER);
  PERFORM extensions.dblink_exec('friend_block_a', format(
    'DELETE FROM public.friendships WHERE %L IN (user_low, user_high);
     DELETE FROM public.user_handles WHERE user_id IN (%L, %L)',
    v_sender, v_sender, v_blocker));
  PERFORM extensions.dblink_disconnect('friend_block_a');
  PERFORM extensions.dblink_disconnect('friend_block_b');
  ASSERT v_waited AND v_result = 'pending' AND v_incoming = 0 AND v_outgoing = 1,
    'a request concurrent with blocking stays visible only to its sender';
END;
$$;

-- Blocked and ordinary requests have the same outgoing view. Each account
-- sees only its own block, and an outgoing shadow never reaches the blocker.
DO $$
DECLARE
  v_blocker TEXT := 'dddddddd-0000-4000-8000-000000002471';
  v_sender  TEXT := 'dddddddd-0000-4000-8000-000000002472';
  v_control TEXT := 'dddddddd-0000-4000-8000-000000002473';
  v_other   TEXT := 'dddddddd-0000-4000-8000-000000002474';
  v_error TEXT;
BEGIN
  INSERT INTO public.user_handles(user_id, handle) VALUES
    (v_blocker, 'blocker247'), (v_sender, 'sender247'), (v_control, 'control247'), (v_other, 'other247');

  ASSERT public.remove_friend(v_blocker, 'sender247', TRUE), 'the first user may block';
  ASSERT (SELECT state FROM public.friend_lookup(v_sender, 'blocker247')) = 'none',
    'looking before asking does not expose a block';
  ASSERT public.request_friend(v_sender, 'blocker247') = 'pending';
  ASSERT public.request_friend(v_sender, 'control247') = 'pending';
  ASSERT (SELECT state FROM public.friend_lookup(v_sender, 'blocker247')) =
         (SELECT state FROM public.friend_lookup(v_sender, 'control247')),
    'lookup after a successful blocked request must match an ordinary request';
  ASSERT (SELECT count(*) FROM public.friend_requests(v_sender) WHERE direction = 'outgoing') = 2,
    'both requests appear in the sender list';
  ASSERT NOT EXISTS (SELECT 1 FROM public.friend_requests(v_blocker)),
    'the blocker receives no incoming request';
  ASSERT (SELECT state FROM public.friend_lookup(v_blocker, 'sender247')) = 'blocked';

  PERFORM set_config('request.jwt.claim.sub', v_sender, TRUE);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_sender)::TEXT, TRUE);
  EXECUTE 'SET LOCAL ROLE authenticated';
  ASSERT (SELECT count(*) FROM public.friendships WHERE state = 'pending' AND requested_by = v_sender AND blocked_by IS NULL) = 2,
    'direct authenticated reads cannot distinguish the two pending rows';
  ASSERT NOT EXISTS (SELECT 1 FROM public.friendships WHERE state = 'blocked'), 'a peer cannot read the block';
  ASSERT NOT has_schema_privilege('authenticated', 'devshark_private', 'USAGE'),
    'the RLS helper cannot be resolved as a browser-callable function';
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', v_blocker, TRUE);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_blocker)::TEXT, TRUE);
  EXECUTE 'SET LOCAL ROLE authenticated';
  ASSERT (SELECT count(*) FROM public.friendships) = 1, 'only the blocker’s own block is visible';
  ASSERT EXISTS (SELECT 1 FROM public.friendships WHERE state = 'blocked' AND blocked_by = v_blocker);
  ASSERT NOT has_table_privilege('authenticated', 'public.friendships', 'INSERT,UPDATE,DELETE'), 'browser writes stay denied';
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', v_control, TRUE);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_control)::TEXT, TRUE);
  EXECUTE 'SET LOCAL ROLE authenticated';
  ASSERT (SELECT count(*) FROM public.friendships WHERE state = 'pending' AND requested_by = v_sender) = 1,
    'the unblocked recipient still sees an incoming pending request';
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', v_other, TRUE);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_other)::TEXT, TRUE);
  EXECUTE 'SET LOCAL ROLE authenticated';
  ASSERT NOT EXISTS (SELECT 1 FROM public.friendships), 'another account sees neither participant’s rows';
  EXECUTE 'RESET ROLE';

  BEGIN
    PERFORM public.respond_friend(v_blocker, 'sender247', TRUE);
  EXCEPTION WHEN raise_exception THEN v_error := SQLERRM;
  END;
  ASSERT v_error IS NOT DISTINCT FROM 'no_request', 'even a direct accept cannot see the muted request';
  ASSERT public.remove_friend(v_blocker, 'sender247', TRUE), 'a duplicate block is idempotent';
  ASSERT (SELECT state FROM public.friend_lookup(v_sender, 'blocker247')) = 'pending_out',
    'a repeated block does not disturb the sender projection';

  -- A muted row consumes one of the same 50 outbound slots. Cancelling it
  -- returns that slot and leaves the other account’s block in place.
  INSERT INTO public.friendships (user_low, user_high, requested_by, state)
  SELECT v_sender, 'zz-friend247-' || n, v_sender, 'pending' FROM generate_series(1, 48) n;
  v_error := NULL;
  BEGIN
    PERFORM public.request_friend(v_sender, 'other247');
  EXCEPTION WHEN raise_exception THEN v_error := SQLERRM;
  END;
  ASSERT v_error IS NOT DISTINCT FROM 'pending_limit_reached', 'the private request counts against the same quota';
  ASSERT public.remove_friend(v_sender, 'blocker247', FALSE), 'the sender can cancel an outgoing request';
  ASSERT public.request_friend(v_sender, 'other247') = 'pending', 'the cancellation returned a slot';
  ASSERT (SELECT state FROM public.friend_lookup(v_blocker, 'sender247')) = 'blocked';
  ASSERT (SELECT state FROM public.friend_lookup(v_sender, 'blocker247')) = 'none';
  ASSERT public.remove_friend(v_sender, 'other247', FALSE);

  -- The later block survives removal of the first one. A request made during
  -- the remaining block cannot turn into a live incoming request on unblock.
  ASSERT public.request_friend(v_sender, 'blocker247') = 'pending';
  ASSERT public.remove_friend(v_sender, 'blocker247', TRUE), 'the second user may also block';
  ASSERT (SELECT state FROM public.friend_lookup(v_sender, 'blocker247')) = 'blocked';
  ASSERT (SELECT state FROM public.friend_lookup(v_blocker, 'sender247')) = 'blocked';
  ASSERT public.remove_friend(v_blocker, 'sender247', FALSE);
  ASSERT (SELECT state FROM public.friend_lookup(v_sender, 'blocker247')) = 'blocked',
    'unblocking cannot remove someone else’s block';
  ASSERT public.request_friend(v_blocker, 'sender247') = 'pending';
  ASSERT NOT EXISTS (SELECT 1 FROM public.friend_requests(v_sender) WHERE handle = 'blocker247');
  ASSERT public.remove_friend(v_sender, 'blocker247', FALSE);
  ASSERT NOT EXISTS (SELECT 1 FROM public.friend_requests(v_sender) WHERE handle = 'blocker247');
  ASSERT (SELECT state FROM public.friend_lookup(v_blocker, 'sender247')) = 'none';
  ASSERT public.request_friend(v_blocker, 'sender247') = 'pending';
  ASSERT public.respond_friend(v_sender, 'blocker247', TRUE) = 'accepted';

  -- The established erasure procedure removes ordinary and directional rows.
  ASSERT public.remove_friend(v_blocker, 'sender247', TRUE);
  ASSERT public.request_friend(v_sender, 'blocker247') = 'pending';
  PERFORM public.delete_user_data(v_sender);
  ASSERT NOT EXISTS (SELECT 1 FROM public.friendships WHERE v_sender IN (user_low, user_high));
  ASSERT NOT EXISTS (SELECT 1 FROM public.user_handles WHERE user_id = v_sender);
END;
$$;
