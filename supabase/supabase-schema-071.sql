-- Migration 071: serialize friendship transitions and enforce both friend limits.
-- Apply after 070. Safe to re-run. Existing callers keep the same routine
-- signatures and result types. No friendship rows change on rollout.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF to_regprocedure('public.friend_user_for_handle(text,boolean)') IS NULL
     OR to_regprocedure('public.save_learning_path_draft_v2(text,text,text,integer,jsonb,integer)') IS NULL THEN
    RAISE EXCEPTION 'migration 071 needs migrations 033 and 070 first';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.lock_friendship_accounts(p_first TEXT, p_second TEXT)
RETURNS VOID LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_first BIGINT := hashtextextended('devshark:friendships:' || p_first, 0);
  v_second BIGINT := hashtextextended('devshark:friendships:' || p_second, 0);
BEGIN
  -- A new relationship has no row to lock. All writers take the account
  -- locks in the same numeric order before touching the pair.
  PERFORM pg_advisory_xact_lock(LEAST(v_first, v_second));
  IF v_first <> v_second THEN
    PERFORM pg_advisory_xact_lock(GREATEST(v_first, v_second));
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.friendship_has_capacity(p_user_id TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.friendships f
    WHERE f.state = 'accepted' AND p_user_id IN (f.user_low, f.user_high)
    OFFSET 199
  );
$$;

CREATE OR REPLACE FUNCTION public.request_friend(p_user_id TEXT, p_handle TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '3s' AS $$
DECLARE
  v_other TEXT := public.friend_user_for_handle(p_handle, TRUE);
  v_low   TEXT := LEAST(p_user_id, v_other);
  v_high  TEXT := GREATEST(p_user_id, v_other);
  v_row   public.friendships%ROWTYPE;
  v_found BOOLEAN;
BEGIN
  IF v_other IS NULL THEN RAISE EXCEPTION 'handle_not_found'; END IF;
  IF v_other = p_user_id THEN RAISE EXCEPTION 'cannot_friend_self'; END IF;
  PERFORM public.lock_friendship_accounts(p_user_id, v_other);

  SELECT * INTO v_row FROM public.friendships f
   WHERE f.user_low = v_low AND f.user_high = v_high FOR UPDATE;
  v_found := FOUND;

  IF v_row.state = 'accepted' THEN RETURN 'accepted'; END IF;

  IF v_row.state = 'pending' THEN
    IF v_row.requested_by = p_user_id THEN RETURN 'pending'; END IF;
    -- Asking back accepts the other person's request. Both accounts need a slot.
    IF NOT public.friendship_has_capacity(p_user_id) OR NOT public.friendship_has_capacity(v_other) THEN
      RAISE EXCEPTION 'friend_limit_reached';
    END IF;
    UPDATE public.friendships
       SET state = 'accepted', responded_at = NOW(), updated_at = NOW()
     WHERE user_low = v_low AND user_high = v_high;
    RETURN 'accepted';
  END IF;

  IF v_row.state = 'declined' AND v_row.requested_by = p_user_id THEN
    RAISE EXCEPTION 'request_declined';
  END IF;
  IF NOT public.friendship_has_capacity(p_user_id) THEN RAISE EXCEPTION 'friend_limit_reached'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.friendships f
     WHERE f.state = 'pending' AND f.requested_by = p_user_id AND p_user_id IN (f.user_low, f.user_high)
     OFFSET 49
  ) THEN RAISE EXCEPTION 'pending_limit_reached'; END IF;

  -- A blocked pair answers exactly as a new request would, including the
  -- caller's ordinary limits. Otherwise the limits would expose the block.
  IF v_row.state = 'blocked' THEN RETURN 'pending'; END IF;

  IF v_found THEN
    -- The person who declined may change their mind.
    UPDATE public.friendships
       SET state = 'pending', requested_by = p_user_id, responded_at = NULL, updated_at = NOW()
     WHERE user_low = v_low AND user_high = v_high;
  ELSE
    INSERT INTO public.friendships (user_low, user_high, requested_by, state)
    VALUES (v_low, v_high, p_user_id, 'pending');
  END IF;
  RETURN 'pending';
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_friend(p_user_id TEXT, p_handle TEXT, p_accept BOOLEAN)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '3s' AS $$
DECLARE
  v_other TEXT := public.friend_user_for_handle(p_handle, FALSE);
  v_low   TEXT := LEAST(p_user_id, v_other);
  v_high  TEXT := GREATEST(p_user_id, v_other);
  v_row   public.friendships%ROWTYPE;
BEGIN
  IF v_other IS NULL THEN RAISE EXCEPTION 'handle_not_found'; END IF;
  PERFORM public.lock_friendship_accounts(p_user_id, v_other);

  SELECT * INTO v_row FROM public.friendships f
   WHERE f.user_low = v_low AND f.user_high = v_high FOR UPDATE;
  IF NOT FOUND OR v_row.state <> 'pending' OR v_row.requested_by = p_user_id THEN
    RAISE EXCEPTION 'no_request';
  END IF;
  IF p_accept AND (NOT public.friendship_has_capacity(p_user_id) OR NOT public.friendship_has_capacity(v_other)) THEN
    RAISE EXCEPTION 'friend_limit_reached';
  END IF;

  UPDATE public.friendships
     SET state = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,
         responded_at = NOW(), updated_at = NOW()
   WHERE user_low = v_low AND user_high = v_high;
  RETURN CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_friend(p_user_id TEXT, p_handle TEXT, p_block BOOLEAN DEFAULT FALSE)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '3s' AS $$
DECLARE
  v_other TEXT := public.friend_user_for_handle(p_handle, FALSE);
  v_low   TEXT := LEAST(p_user_id, v_other);
  v_high  TEXT := GREATEST(p_user_id, v_other);
  v_hit   INTEGER;
BEGIN
  IF v_other IS NULL THEN RAISE EXCEPTION 'handle_not_found'; END IF;
  IF v_other = p_user_id THEN RAISE EXCEPTION 'cannot_friend_self'; END IF;
  PERFORM public.lock_friendship_accounts(p_user_id, v_other);

  IF p_block THEN
    INSERT INTO public.friendships (user_low, user_high, requested_by, state, blocked_by)
    VALUES (v_low, v_high, p_user_id, 'blocked', p_user_id)
    ON CONFLICT (user_low, user_high) DO UPDATE
       SET state = 'blocked', blocked_by = p_user_id, updated_at = NOW()
     WHERE public.friendships.state <> 'blocked';
    RETURN TRUE;
  END IF;

  DELETE FROM public.friendships f
   WHERE f.user_low = v_low AND f.user_high = v_high
     AND (f.state <> 'blocked' OR f.blocked_by = p_user_id);
  GET DIAGNOSTICS v_hit = ROW_COUNT;
  RETURN v_hit > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.lock_friendship_accounts(TEXT, TEXT), public.friendship_has_capacity(TEXT),
  public.request_friend(TEXT, TEXT), public.respond_friend(TEXT, TEXT, BOOLEAN), public.remove_friend(TEXT, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_friendship_accounts(TEXT, TEXT), public.friendship_has_capacity(TEXT),
  public.request_friend(TEXT, TEXT), public.respond_friend(TEXT, TEXT, BOOLEAN), public.remove_friend(TEXT, TEXT, BOOLEAN)
  TO service_role;
COMMIT;
