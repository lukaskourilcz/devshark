-- The effective relationship, including a hidden user's own request, decides
-- whether a learner can act on their handle. A stranger cannot create a block
-- by guessing the name of an undiscoverable account.
DO $$
DECLARE
  learner TEXT := gen_random_uuid()::text;
  other_user TEXT := gen_random_uuid()::text;
  learner_handle TEXT := 'viewer-' || left(learner, 8);
  other_handle TEXT := 'hidden-' || left(other_user, 8);
BEGIN
  INSERT INTO public.user_handles(user_id, handle, discoverable)
    VALUES (learner, learner_handle, TRUE), (other_user, other_handle, FALSE);
  BEGIN
    PERFORM public.remove_friend(learner, other_handle, TRUE);
    RAISE EXCEPTION 'unexpected hidden stranger block';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'handle_not_found' THEN RAISE; END IF;
  END;
  ASSERT NOT EXISTS (SELECT 1 FROM public.friendships WHERE blocked_by = learner);
  ASSERT public.request_friend(other_user, learner_handle) = 'pending';
  ASSERT public.remove_friend(learner, other_handle, TRUE);
  ASSERT EXISTS (SELECT 1 FROM public.friendships WHERE blocked_by = learner);
END;
$$;
