SET LOCAL ROLE service_role;

DO $$
DECLARE
  v_user CONSTANT TEXT := 'aaaaaaaa-0000-4000-8000-000000002441';
  v_result JSONB;
BEGIN
  -- The running version wrote this before the new RPC existed.
  PERFORM public.record_concept_review(v_user, 'js-map', 'webdev', 'legacy',
    1::SMALLINT, NOW() + INTERVAL '1 day', 1, 'q1', 'v1', 'independent', TRUE, 1);
  v_result := public.record_concept_review_v2(v_user, 'js-map', 'webdev', 'second',
    2::SMALLINT, NOW() + INTERVAL '2 days', 2, 'q2', 'v1', 'independent', TRUE, 1, 1);
  ASSERT (v_result ->> 'applied')::BOOLEAN, format('matching revision was refused: %s', v_result);

  -- Both request handlers computed from revision 1. The second writer
  -- must recompute rather than silently applying the same stage twice.
  v_result := public.record_concept_review_v2(v_user, 'js-map', 'webdev', 'third',
    2::SMALLINT, NOW() + INTERVAL '2 days', 2, 'q3', 'v1', 'independent', TRUE, 1, 1);
  ASSERT v_result ->> 'state' = 'stale' AND v_result ->> 'reviews' = '2' AND
    v_result ->> 'stage' = '2' AND v_result ->> 'lastItemId' = 'q2',
    format('a stale update did not return current state: %s', v_result);
  v_result := public.record_concept_review_v2(v_user, 'js-map', 'webdev', 'third',
    3::SMALLINT, NOW() + INTERVAL '3 days', 3, 'q3', 'v1', 'independent', TRUE, 1, 2);
  ASSERT (v_result ->> 'applied')::BOOLEAN, format('recomputed transition was refused: %s', v_result);

  -- Replays can arrive out of order after other reviews, including a v1
  -- event that was already the row's latest event at rollout.
  FOR v_result IN
    SELECT public.record_concept_review_v2(v_user, 'js-map', 'webdev', event_id,
      0::SMALLINT, NOW(), 0, 'bad', NULL, 'hinted', FALSE, 1, 3)
    FROM (VALUES ('legacy'), ('second'), ('third')) AS events(event_id)
  LOOP
    ASSERT v_result ->> 'applied' = 'false', format('a replay changed state: %s', v_result);
  END LOOP;
  ASSERT (SELECT stage = 3 AND streak = 3 AND reviews = 3 AND last_event_id = 'third'
            FROM public.concept_reviews WHERE user_id = v_user AND concept_id = 'js-map');
  ASSERT (SELECT count(*) FROM public.concept_review_receipts WHERE user_id = v_user) = 3;

  UPDATE public.concept_review_receipts SET created_at = NOW() - INTERVAL '8 days'
   WHERE user_id = v_user AND event_id = 'legacy';
  PERFORM public.purge_expired_learning_data();
  ASSERT (SELECT count(*) FROM public.concept_review_receipts WHERE user_id = v_user) = 2;
  ASSERT (SELECT reviews FROM public.concept_reviews WHERE user_id = v_user) = 3;
END;
$$;
