-- Migration 075: protect blocked requests on every friendship read.
-- Apply after 074. Safe to repeat. Retains existing rows, column shapes,
-- routine signatures, and the read-only authenticated table contract.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF to_regprocedure('public.lock_friendship_accounts(text,text)') IS NULL THEN
    RAISE EXCEPTION 'migration 075 needs migration 071 first';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication_tables
    WHERE schemaname = 'public' AND tablename = 'friendships'
  ) THEN
    RAISE EXCEPTION 'migration 075 requires checking friendship replication and privacy before rollout';
  END IF;
  IF to_regclass('public.friendships_pair_and_blocker_key') IS NULL THEN
    -- A NULL blocker identifies the single ordinary relation. Each account
    -- can independently own a blocked row without changing the other one.
    ALTER TABLE public.friendships
      DROP CONSTRAINT friendships_pkey,
      ADD CONSTRAINT friendships_pair_and_blocker_key
        UNIQUE NULLS NOT DISTINCT (user_low, user_high, blocked_by);
  END IF;
END;
$$;

-- Policy expressions can execute the already resolved function, but the
-- browser roles cannot resolve it directly or through the public Data API.
CREATE SCHEMA IF NOT EXISTS devshark_private;
REVOKE ALL ON SCHEMA devshark_private FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION devshark_private.friendship_blocked_by_viewer(p_low TEXT, p_high TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.friendships f
    WHERE f.user_low = p_low AND f.user_high = p_high
      AND f.blocked_by = (SELECT auth.uid()::TEXT)
  );
$$;

REVOKE ALL ON FUNCTION devshark_private.friendship_blocked_by_viewer(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION devshark_private.friendship_blocked_by_viewer(TEXT, TEXT) TO authenticated;

DROP POLICY IF EXISTS friendships_select_party ON public.friendships;
CREATE POLICY friendships_select_party ON public.friendships FOR SELECT TO authenticated
USING (
  (SELECT auth.uid()::TEXT) IN (user_low, user_high)
  AND (
    blocked_by = (SELECT auth.uid()::TEXT)
    OR (
      blocked_by IS NULL
      AND (
        requested_by = (SELECT auth.uid()::TEXT)
        OR NOT devshark_private.friendship_blocked_by_viewer(user_low, user_high)
      )
    )
  )
);

CREATE OR REPLACE FUNCTION public.request_friend(p_user_id TEXT, p_handle TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '3s' AS $$
DECLARE
  v_other TEXT := public.friend_user_for_handle(p_handle, TRUE);
  v_low   TEXT := LEAST(p_user_id, v_other);
  v_high  TEXT := GREATEST(p_user_id, v_other);
  v_row   public.friendships%ROWTYPE;
  v_found BOOLEAN;
  v_own_block BOOLEAN;
BEGIN
  IF v_other IS NULL THEN RAISE EXCEPTION 'handle_not_found'; END IF;
  IF v_other = p_user_id THEN RAISE EXCEPTION 'cannot_friend_self'; END IF;
  PERFORM public.lock_friendship_accounts(p_user_id, v_other);

  SELECT * INTO v_row FROM public.friendships f
   WHERE f.user_low = v_low AND f.user_high = v_high AND f.blocked_by IS NULL FOR UPDATE;
  v_found := FOUND;
  SELECT EXISTS (
    SELECT 1 FROM public.friendships f
    WHERE f.user_low = v_low AND f.user_high = v_high AND f.blocked_by = p_user_id
  ) INTO v_own_block;

  IF NOT v_own_block AND v_row.state = 'accepted' THEN RETURN 'accepted'; END IF;

  IF NOT v_own_block AND v_row.state = 'pending' THEN
    IF v_row.requested_by = p_user_id THEN RETURN 'pending'; END IF;
    -- Asking back accepts the other person's request. Both accounts need a slot.
    IF NOT public.friendship_has_capacity(p_user_id) OR NOT public.friendship_has_capacity(v_other) THEN
      RAISE EXCEPTION 'friend_limit_reached';
    END IF;
    UPDATE public.friendships
       SET state = 'accepted', responded_at = NOW(), updated_at = NOW()
     WHERE user_low = v_low AND user_high = v_high AND blocked_by IS NULL;
    RETURN 'accepted';
  END IF;

  IF NOT v_own_block AND v_row.state = 'declined' AND v_row.requested_by = p_user_id THEN
    RAISE EXCEPTION 'request_declined';
  END IF;
  IF NOT public.friendship_has_capacity(p_user_id) THEN RAISE EXCEPTION 'friend_limit_reached'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.friendships f
     WHERE f.state = 'pending' AND f.requested_by = p_user_id AND p_user_id IN (f.user_low, f.user_high)
     OFFSET 49
  ) THEN RAISE EXCEPTION 'pending_limit_reached'; END IF;

  -- Only the owner of a block can know about it. A request towards someone
  -- who blocked the caller gets the ordinary pending row and quota. That
  -- row stays private to the caller while the block exists. A caller who
  -- already blocks the target cannot create an incoming request themselves.
  IF v_own_block THEN RETURN 'pending'; END IF;

  IF v_found THEN
    -- The person who declined may change their mind.
    UPDATE public.friendships
       SET state = 'pending', requested_by = p_user_id, responded_at = NULL, updated_at = NOW()
     WHERE user_low = v_low AND user_high = v_high AND blocked_by IS NULL;
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
   WHERE f.user_low = v_low AND f.user_high = v_high AND f.blocked_by IS NULL FOR UPDATE;
  IF NOT FOUND OR v_row.state <> 'pending' OR v_row.requested_by = p_user_id OR EXISTS (
    SELECT 1 FROM public.friendships f
    WHERE f.user_low = v_low AND f.user_high = v_high AND f.blocked_by IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'no_request';
  END IF;
  IF p_accept AND (NOT public.friendship_has_capacity(p_user_id) OR NOT public.friendship_has_capacity(v_other)) THEN
    RAISE EXCEPTION 'friend_limit_reached';
  END IF;

  UPDATE public.friendships
     SET state = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,
         responded_at = NOW(), updated_at = NOW()
   WHERE user_low = v_low AND user_high = v_high AND blocked_by IS NULL;
  RETURN CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.friend_lookup(p_user_id TEXT, p_handle TEXT)
RETURNS TABLE (handle TEXT, state TEXT, display_name TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_other  TEXT := public.friend_user_for_handle(p_handle, TRUE);
  v_low    TEXT;
  v_high   TEXT;
  v_row    public.friendships;
  v_found  BOOLEAN;
  v_state  TEXT;
  v_handle TEXT;
BEGIN
  IF v_other IS NULL THEN RETURN; END IF;

  SELECT h.handle INTO v_handle FROM public.user_handles h WHERE h.user_id = v_other;

  IF v_other = p_user_id THEN
    RETURN QUERY SELECT v_handle, 'self'::TEXT, public.friend_display_name(v_other);
    RETURN;
  END IF;

  v_low  := LEAST(p_user_id, v_other);
  v_high := GREATEST(p_user_id, v_other);
  SELECT * INTO v_row FROM public.friendships f
   WHERE f.user_low = v_low AND f.user_high = v_high
     AND (f.blocked_by IS NULL OR f.blocked_by = p_user_id)
   ORDER BY (f.blocked_by IS NOT NULL) DESC
   LIMIT 1;
  v_found := FOUND;

  IF NOT v_found THEN
    v_state := 'none';
  ELSIF v_row.state = 'accepted' THEN
    v_state := 'accepted';
  ELSIF v_row.state = 'blocked' THEN
    v_state := 'blocked';
  ELSIF v_row.state = 'declined' THEN
    v_state := CASE WHEN v_row.requested_by = p_user_id THEN 'declined_out' ELSE 'declined_in' END;
  ELSE
    v_state := CASE WHEN v_row.requested_by = p_user_id THEN 'pending_out' ELSE 'pending_in' END;
  END IF;

  RETURN QUERY SELECT v_handle, v_state,
    CASE WHEN v_state = 'accepted' THEN public.friend_display_name(v_other) ELSE v_handle END;
END;
$$;

CREATE OR REPLACE FUNCTION public.friend_requests(p_user_id TEXT)
RETURNS TABLE (handle TEXT, direction TEXT, requested_at TIMESTAMPTZ, display_name TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT h.handle,
         CASE WHEN f.requested_by = p_user_id THEN 'outgoing' ELSE 'incoming' END,
         f.created_at,
         CASE WHEN f.requested_by = p_user_id THEN h.handle
              ELSE public.friend_display_name(h.user_id) END
    FROM public.friendships f
    JOIN public.user_handles h
      ON h.user_id = CASE WHEN f.user_low = p_user_id THEN f.user_high ELSE f.user_low END
   WHERE f.state = 'pending'
     AND p_user_id IN (f.user_low, f.user_high)
     AND (
       f.requested_by = p_user_id
       OR NOT EXISTS (
         SELECT 1 FROM public.friendships block
          WHERE block.user_low = f.user_low AND block.user_high = f.user_high
            AND block.blocked_by = p_user_id
       )
     )
   ORDER BY f.created_at DESC
   LIMIT 100;
$$;

REVOKE ALL ON FUNCTION public.request_friend(TEXT, TEXT), public.respond_friend(TEXT, TEXT, BOOLEAN),
  public.remove_friend(TEXT, TEXT, BOOLEAN), public.friend_lookup(TEXT, TEXT), public.friend_requests(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_friend(TEXT, TEXT), public.respond_friend(TEXT, TEXT, BOOLEAN),
  public.remove_friend(TEXT, TEXT, BOOLEAN), public.friend_lookup(TEXT, TEXT), public.friend_requests(TEXT)
  TO service_role;

COMMIT;
