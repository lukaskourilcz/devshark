-- Abort at the final reward write, then retry the same sealed attempt.
CREATE FUNCTION pg_temp.fail_learn_reward()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_setting('devshark.test_fail_learn_reward', TRUE) = TG_TABLE_NAME THEN
    RAISE SQLSTATE 'XX000' USING MESSAGE = 'synthetic reward write failure';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER test_fail_learn_coins BEFORE INSERT ON public.token_xp_credits
FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_learn_reward();
CREATE TRIGGER test_fail_learn_streak BEFORE UPDATE ON public.user_stats
FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_learn_reward();

SET LOCAL ROLE service_role;

DO $$
DECLARE
  v_user CONSTANT TEXT := 'aaaaaaaa-0000-4000-8000-000000002481';
  v_first CONSTANT TEXT := 'learnreward24800001';
  v_repeat CONSTANT TEXT := 'learnreward24800002';
  v_coins CONSTANT TEXT := 'xp:learn:' || v_user || ':css:L2';
  v_outcome JSONB;
BEGIN
  PERFORM public.record_roadmap_answer_v2(v_first, v_user, 'q1', 1, 1, 'webdev', 'css', 'level', 2, 1, 100);
  PERFORM set_config('devshark.test_fail_learn_reward', 'token_xp_credits', TRUE);
  BEGIN
    PERFORM public.complete_verified_roadmap_attempt_v3(v_user, v_first, NULL, 0.1, 2, 400);
    ASSERT FALSE, 'the first pass did not surface the failed reward write';
  EXCEPTION WHEN SQLSTATE 'XX000' THEN
    ASSERT SQLERRM = 'synthetic reward write failure', SQLERRM;
  END;
  ASSERT (SELECT completed_at IS NULL FROM public.roadmap_attempts WHERE attempt_id = v_first), 'the failed credit must roll back completion';
  ASSERT NOT EXISTS (SELECT 1 FROM public.roadmap_progress WHERE user_id = v_user), 'the failed credit must roll back progress';
  ASSERT NOT EXISTS (SELECT 1 FROM public.user_xp_days WHERE user_id = v_user), 'the failed credit must roll back XP';
  ASSERT NOT EXISTS (SELECT 1 FROM public.token_xp_credits WHERE event_id = v_coins), 'the failed credit left no receipt';

  PERFORM set_config('devshark.test_fail_learn_reward', '', TRUE);
  v_outcome := public.complete_verified_roadmap_attempt_v3(v_user, v_first, NULL, 0.1, 2, 400);
  ASSERT v_outcome->'applied' = 'true'::JSONB AND v_outcome->'firstPass' = 'true'::JSONB, v_outcome::TEXT;
  ASSERT (SELECT xp = 50 AND credited = 5 FROM public.token_xp_credits WHERE event_id = v_coins), 'the original credit is paid once';
  ASSERT (SELECT amount = 5 FROM public.token_ledger WHERE event_id = v_coins), 'the wallet receives the exact credit';
  ASSERT (SELECT sum(xp) = 50 FROM public.user_xp_days WHERE user_id = v_user), 'learning XP is recorded once';

  v_outcome := public.complete_verified_roadmap_attempt_v3(v_user, v_first, NULL, 0.1, 2, 400);
  ASSERT v_outcome->'applied' = 'false'::JSONB, v_outcome::TEXT;

  PERFORM public.record_roadmap_answer_v2(v_repeat, v_user, 'q1', 1, 1, 'webdev', 'css', 'level', 2, 1, 100);
  UPDATE public.user_learn_step_xp SET last_xp_at = NOW() - INTERVAL '2 hours' WHERE user_id = v_user;
  v_outcome := public.complete_verified_roadmap_attempt_v3(v_user, v_repeat, NULL, 0.1, 2, 400);
  ASSERT v_outcome->'firstPass' = 'false'::JSONB AND v_outcome #>> '{repeatXp,xp}' = '50', v_outcome::TEXT;
  ASSERT (SELECT count(*) = 1 FROM public.token_xp_credits WHERE user_id = v_user), 'a replay of the step earns no coins';
END;
$$;

DO $$
DECLARE
  v_user CONSTANT TEXT := 'aaaaaaaa-0000-4000-8000-000000002482';
  v_attempt CONSTANT TEXT := 'learnreward24800003';
BEGIN
  FOR i IN 1..3 LOOP
    PERFORM public.record_roadmap_answer_v2(v_attempt, v_user, 'q' || i, 0, 1, 'webdev', 'css', 'level', 2, 4, 75);
  END LOOP;
  PERFORM set_config('devshark.test_fail_learn_reward', 'user_stats', TRUE);
  BEGIN
    PERFORM public.complete_roadmap_attempt_on_hearts(v_user, v_attempt);
    ASSERT FALSE, 'the last-heart close did not surface the failed streak write';
  EXCEPTION WHEN SQLSTATE 'XX000' THEN
    ASSERT SQLERRM = 'synthetic reward write failure', SQLERRM;
  END;
  ASSERT (SELECT completed_at IS NULL FROM public.roadmap_attempts WHERE attempt_id = v_attempt), 'the failed streak must roll back the close';
  ASSERT NOT EXISTS (SELECT 1 FROM public.user_stats WHERE user_id = v_user), 'the failed streak left no partial row';

  PERFORM set_config('devshark.test_fail_learn_reward', '', TRUE);
  ASSERT public.complete_roadmap_attempt_on_hearts(v_user, v_attempt), 'retry closes the attempt';
  ASSERT NOT public.complete_roadmap_attempt_on_hearts(v_user, v_attempt), 'repeating the same close reports no change';
  ASSERT (SELECT completed_at IS NOT NULL AND NOT passed AND score_pct = 0 FROM public.roadmap_attempts WHERE attempt_id = v_attempt), 'the answer rows determined a failed score';
  ASSERT (SELECT current_streak = 1 AND last_quiz_date = (NOW() AT TIME ZONE 'UTC')::DATE FROM public.user_stats WHERE user_id = v_user), 'the same close records exactly one streak day';
  ASSERT NOT has_function_privilege('authenticated', 'public.complete_roadmap_attempt_on_hearts(text,text)', 'EXECUTE'), 'client cannot close the attempt directly';
  ASSERT NOT has_function_privilege('authenticated', 'public.complete_verified_roadmap_attempt_v3(text,text,jsonb,numeric,integer,integer)', 'EXECUTE'), 'client cannot set coin policy';
END;
$$;
