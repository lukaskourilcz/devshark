-- Removing or blocking a stranger by handle must respect discoverability.
-- Rollback: restore public.remove_friend from migration 075. Existing grants
-- and comments survive CREATE OR REPLACE.
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';

CREATE OR REPLACE FUNCTION public.remove_friend(p_user_id TEXT, p_handle TEXT, p_block BOOLEAN DEFAULT FALSE)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '3s' AS $$
DECLARE
  v_other TEXT := public.friend_user_for_handle(p_handle, FALSE);
  v_low   TEXT := LEAST(p_user_id, v_other);
  v_high  TEXT := GREATEST(p_user_id, v_other);
BEGIN
  IF v_other IS NULL THEN RAISE EXCEPTION 'handle_not_found'; END IF;
  IF v_other = p_user_id THEN RAISE EXCEPTION 'cannot_friend_self'; END IF;
  PERFORM public.lock_friendship_accounts(p_user_id, v_other);
  -- A hidden account may still send a request or be an existing friend.
  -- Only that relationship makes its handle actionable to the other party.
  IF NOT EXISTS (SELECT 1 FROM public.user_handles WHERE user_id = v_other AND discoverable)
     AND NOT EXISTS (SELECT 1 FROM public.friendships
                     WHERE user_low = v_low AND user_high = v_high
                       AND (blocked_by IS NULL OR blocked_by = p_user_id)) THEN
    RAISE EXCEPTION 'handle_not_found';
  END IF;


  IF p_block THEN
    INSERT INTO public.friendships (user_low, user_high, requested_by, state, blocked_by)
    VALUES (v_low, v_high, p_user_id, 'blocked', p_user_id)
    ON CONFLICT (user_low, user_high, blocked_by) DO NOTHING;
    IF FOUND THEN
      DELETE FROM public.friendships f
       WHERE f.user_low = v_low AND f.user_high = v_high AND f.blocked_by IS NULL;
    END IF;
    RETURN TRUE;
  END IF;

  -- Removing one's own block also drops the muted request. It must never
  -- turn into a real incoming request after the target lifts the block.
  DELETE FROM public.friendships f
   WHERE f.user_low = v_low AND f.user_high = v_high
     AND (f.blocked_by IS NULL OR f.blocked_by = p_user_id);
  RETURN FOUND;
END;
$$;

COMMIT;
