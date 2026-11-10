SET LOCAL ROLE service_role;

DO $$
DECLARE
  v_user CONSTANT TEXT := 'aaaaaaaa-0000-4000-8000-000000000240';
  v_legacy CONSTANT TEXT := 'aaaaaaaa-0000-4000-8000-000000000241';
  v_run CONSTANT TEXT := 'heldreplay0000000001';
  v_old_run CONSTANT TEXT := 'heldreplay0000000002';
  v_answers CONSTANT JSONB := '[{"questionId":"q-held","category":"javascript","isCorrect":true,"xp":5}]';
  v_result JSONB;
BEGIN
  INSERT INTO public.user_question_xp (user_id, subject, question_id, last_xp_at)
  VALUES (v_user, 'webdev', 'q-held', NOW() - INTERVAL '10 minutes'),
         (v_legacy, 'webdev', 'q-held', NOW() - INTERVAL '10 minutes');

  v_result := public.record_challenge_completion_v2(v_user, v_run, 'webdev', 5, NULL, v_answers);
  ASSERT NOT (v_result->>'awarded')::BOOLEAN AND (v_result->>'xp')::INTEGER = 0
    AND (v_result #>> '{xpHeld,questions}')::INTEGER = 1
    AND (v_result #>> '{xpHeld,availableAt}')::TIMESTAMPTZ = NOW() + INTERVAL '50 minutes',
    'a fully held run reports its cooldown on first completion';
  ASSERT NOT public.record_challenge_completion(v_legacy, v_old_run, 'webdev', 5, NULL, v_answers),
    'the legacy completion returns false for a held run';

  UPDATE public.user_question_xp
  SET last_xp_at = NOW() - INTERVAL '61 minutes'
  WHERE user_id IN (v_user, v_legacy) AND question_id = 'q-held';

  v_result := public.record_challenge_completion_v2(v_user, v_run, 'webdev', 5, NULL, v_answers);
  ASSERT v_result = '{"awarded":false,"xp":0,"xpHeld":null}'::JSONB,
    'an exact replay after cooldown expiry still pays no XP';
  ASSERT NOT public.record_challenge_completion(v_user, v_run, 'webdev', 5, NULL, v_answers),
    'the legacy RPC also refuses a previously held run';
  v_result := public.record_challenge_completion_v2(v_legacy, v_old_run, 'webdev', 5, NULL, v_answers);
  ASSERT v_result = '{"awarded":false,"xp":0,"xpHeld":null}'::JSONB,
    'a completion first sent to the legacy RPC is also final';

  ASSERT NOT EXISTS (SELECT 1 FROM public.verified_activity_awards WHERE user_id IN (v_user, v_legacy))
     AND NOT EXISTS (SELECT 1 FROM public.user_xp WHERE user_id IN (v_user, v_legacy))
     AND NOT EXISTS (SELECT 1 FROM public.user_streak WHERE user_id IN (v_user, v_legacy))
     AND NOT EXISTS (SELECT 1 FROM public.user_stats WHERE user_id IN (v_user, v_legacy)),
    'held replays create no award, progress or streak';
  ASSERT (SELECT count(*) FROM public.user_question_xp
          WHERE user_id IN (v_user, v_legacy) AND last_xp_at = NOW() - INTERVAL '61 minutes') = 2,
    'replays do not start another cooldown';

  v_result := public.record_challenge_completion_v2(v_user, 'heldreplay0000000003', 'webdev', 5, NULL, v_answers);
  ASSERT v_result = '{"awarded":true,"xp":5,"xpHeld":null}'::JSONB,
    'a different run after the cooldown still earns the normal XP';

  ASSERT (SELECT count(*) FROM public.quiz_submissions
          WHERE grade_key IN ('challenge-held:' || v_run, 'challenge-held:' || v_old_run)) = 2,
    'the held completions leave receipts outside the XP ledger';
  PERFORM public.delete_user_data(v_user);
  ASSERT NOT EXISTS (SELECT 1 FROM public.quiz_submissions WHERE grade_key = 'challenge-held:' || v_run),
    'account erasure removes the held receipt';
  UPDATE public.quiz_submissions SET created_at = NOW() - INTERVAL '91 days' WHERE grade_key = 'challenge-held:' || v_old_run;
  PERFORM public.purge_expired_learning_data();
  ASSERT NOT EXISTS (SELECT 1 FROM public.quiz_submissions WHERE grade_key = 'challenge-held:' || v_old_run),
    'expired receipts leave with the rest of the grading claims';
END;
$$;
