-- The month's XP ledger (migration 056). user_xp_days holds the verified XP a
-- learner earned per UTC day and subject, so a calendar month's XP can decide
-- its top three (owner decision 8). Every verified award writes it in its own
-- transaction: a quiz and a daily result (a repeated question once its hour
-- is up, 058), a Biggest Shark Challenge run, a coding challenge's first pass
-- or repeat XP (058) and a
-- Learn level or part test passed for the first time, at the XP
-- shared/progression.ts gives it. A replayed award, a later pass, a failed
-- level, a run that earned nothing and guest XP merged at sign-in
-- from before migration 088 add nothing.

SET LOCAL ROLE service_role;

DO $$
DECLARE
  v_today  CONSTANT DATE := (NOW() AT TIME ZONE 'UTC')::DATE;
  v_user   CONSTANT TEXT := 'aaaaaaaa-0000-4000-8000-000000001911';
  v_guest  CONSTANT TEXT := 'aaaaaaaa-0000-4000-8000-000000001912';
  v_ledger BIGINT;
  v_total  BIGINT;
  v_rows   INTEGER;
  v_result JSONB;
  v_done   BOOLEAN;
BEGIN
  -- Two quizzes worth 12 XP each: both pay, both count. (The same questions
  -- again within the hour would pay nothing: 156-quiz-xp-question-cooldown.)
  PERFORM public.record_verified_quiz_result_v2(
    v_user, 'monthledgerquiz00001', 2, 2, NULL,
    '[{"questionId":"q1","category":"javascript","isCorrect":true,"xp":4},
      {"questionId":"q2","category":"javascript","isCorrect":true,"xp":8}]',
    'webdev', 12);
  PERFORM public.record_verified_quiz_result_v2(
    v_user, 'monthledgerquiz00002', 2, 2, NULL,
    '[{"questionId":"q3","category":"javascript","isCorrect":true,"xp":4},
      {"questionId":"q4","category":"javascript","isCorrect":true,"xp":8}]',
    'webdev', 12);
  -- The receipt replayed: refused, nothing more.
  PERFORM public.record_verified_quiz_result_v2(
    v_user, 'monthledgerquiz00002', 2, 2, NULL,
    '[{"questionId":"q1","category":"javascript","isCorrect":true,"xp":4}]',
    'webdev', 12);
  -- Today's daily: its 20.
  PERFORM public.record_verified_quiz_result_v2(
    v_user, 'monthledgerdaily0001', 1, 2, NULL,
    '[{"questionId":"d1","category":"css","isCorrect":true,"xp":4},
      {"questionId":"d2","category":"css","isCorrect":false,"xp":0}]',
    'webdev', 20, NULL, NULL, NULL, v_today, 60000);
  -- A quiz that earned nothing writes no row of its own.
  PERFORM public.record_verified_quiz_result_v2(
    v_user, 'monthledgerquiz00003', 0, 1, NULL,
    '[{"questionId":"q9","category":"javascript","isCorrect":false,"xp":0}]',
    'webdev', 0);
  SELECT SUM(xp) INTO v_ledger FROM public.user_xp_days WHERE user_id = v_user;
  ASSERT v_ledger = 44, format('quizzes and the daily: 12 + 12 + 20, got %s', v_ledger);

  -- A Biggest Shark Challenge run: its 15, once.
  PERFORM public.record_challenge_completion(v_user, 'monthledgerrun000001', 'webdev', 15, '{"javascript":{"correct":3,"total":4}}');
  PERFORM public.record_challenge_completion(v_user, 'monthledgerrun000001', 'webdev', 15, '{"javascript":{"correct":3,"total":4}}');
  SELECT SUM(xp) INTO v_ledger FROM public.user_xp_days WHERE user_id = v_user;
  ASSERT v_ledger = 59, format('a Challenge run counts once: expected 59, got %s', v_ledger);

  -- A coding challenge: the first pass's 20, not the failed run, the replay
  -- or the later pass.
  PERFORM public.record_coding_verdict(v_user, 'monthledgercode01', 'js-double-numbers', 'javascript', 'failed', TRUE, 20);
  v_result := public.record_coding_verdict(v_user, 'monthledgercode02', 'js-double-numbers', 'javascript', 'passed', TRUE, 20);
  ASSERT (v_result ->> 'xpAwarded')::BOOLEAN, format('the first pass pays: %s', v_result);
  PERFORM public.record_coding_verdict(v_user, 'monthledgercode02', 'js-double-numbers', 'javascript', 'passed', TRUE, 20);
  PERFORM public.record_coding_verdict(v_user, 'monthledgercode03', 'js-double-numbers', 'javascript', 'passed', TRUE, 20);
  SELECT SUM(xp) INTO v_ledger FROM public.user_xp_days WHERE user_id = v_user;
  ASSERT v_ledger = 79, format('a coding first pass counts once: expected 79, got %s', v_ledger);

  -- Learn: a failed level adds nothing; its first pass adds 50 × tier, here
  -- level 7 (tier 2): 100; passing it again adds nothing; part test 2 adds 600.
  PERFORM public.record_roadmap_answer_v2('monthledgerlearn0001', v_user, 'l1', 0, 1, 'webdev', 'html', 'level', 7, 1, 50);
  v_done := public.complete_verified_roadmap_attempt(v_user, 'monthledgerlearn0001');
  ASSERT v_done, 'the failed level completes';
  SELECT SUM(xp) INTO v_ledger FROM public.user_xp_days WHERE user_id = v_user;
  ASSERT v_ledger = 79, format('a failed level earns nothing: expected 79, got %s', v_ledger);
  PERFORM public.record_roadmap_answer_v2('monthledgerlearn0002', v_user, 'l1', 1, 1, 'webdev', 'html', 'level', 7, 1, 50);
  PERFORM public.complete_verified_roadmap_attempt(v_user, 'monthledgerlearn0002');
  PERFORM public.complete_verified_roadmap_attempt(v_user, 'monthledgerlearn0002');
  SELECT SUM(xp) INTO v_ledger FROM public.user_xp_days WHERE user_id = v_user;
  ASSERT v_ledger = 179, format('a first pass of level 7 earns 100, once: expected 179, got %s', v_ledger);
  PERFORM public.record_roadmap_answer_v2('monthledgerlearn0003', v_user, 'l2', 1, 1, 'webdev', 'html', 'level', 7, 1, 50);
  PERFORM public.complete_verified_roadmap_attempt(v_user, 'monthledgerlearn0003');
  PERFORM public.record_roadmap_answer_v2('monthledgerlearn0004', v_user, 'p1', 1, 1, 'webdev', 'html', 'checkpoint', 2, 1, 50);
  PERFORM public.complete_verified_roadmap_attempt(v_user, 'monthledgerlearn0004');
  SELECT SUM(xp) INTO v_ledger FROM public.user_xp_days WHERE user_id = v_user;
  ASSERT v_ledger = 779, format('a replayed level adds nothing and part test 2 adds 600: expected 779, got %s', v_ledger);

  -- One row a day and subject, and it is today's (UTC).
  SELECT count(*) INTO v_rows FROM public.user_xp_days WHERE user_id = v_user;
  ASSERT v_rows = 1, format('one row for the day, got %s', v_rows);
  ASSERT EXISTS (SELECT 1 FROM public.user_xp_days WHERE user_id = v_user AND day = v_today AND subject = 'webdev'),
    'the row is today''s, for the subject';

  -- The ledger holds what user_xp gained, plus the learning XP that lives in
  -- verified progress rather than in user_xp.
  SELECT quest_xp INTO v_total FROM public.user_xp WHERE user_id = v_user;
  ASSERT v_total = 79, format('user_xp holds the quiz, Challenge and coding XP: expected 79, got %s', v_total);

  -- An account can still have an old unverified balance from before 088.
  ASSERT to_regprocedure('public.merge_user_xp(text,bigint,jsonb)') IS NULL, 'no unverified XP writer remains';
  INSERT INTO public.user_xp (user_id, quest_xp, quest_xp_by_subject) VALUES (v_guest, 500, '{"webdev":500}');
  ASSERT NOT EXISTS (SELECT 1 FROM public.user_xp_days WHERE user_id = v_guest), 'merged guest XP is not in the month';

  -- The learning XP the ledger uses is shared/progression.ts's.
  ASSERT public.learn_step_xp('level', 1) = 50 AND public.learn_step_xp('level', 5) = 50 AND
         public.learn_step_xp('level', 6) = 100 AND public.learn_step_xp('level', 25) = 250 AND
         public.learn_step_xp('level', 40) = 250 AND public.learn_step_xp('checkpoint', 1) = 300 AND
         public.learn_step_xp('checkpoint', 3) = 900,
    'learn_step_xp matches learnLevelXp and learnCheckpointXp';
END;
$$;

-- Written by the server only; a learner reads their own rows and no one else's
-- (158-rls-own-rows-only.test.sql checks every own-row table the same way).
RESET ROLE;
DO $$
BEGIN
  ASSERT NOT has_table_privilege('anon', 'public.user_xp_days', 'SELECT'), 'anon reads nothing';
  ASSERT NOT has_table_privilege('authenticated', 'public.user_xp_days', 'INSERT'), 'a learner cannot write XP';
  ASSERT NOT has_table_privilege('authenticated', 'public.user_xp_days', 'UPDATE'), 'or change it';
  ASSERT NOT has_function_privilege('authenticated', 'public.add_xp_day(text, text, integer)', 'EXECUTE'), 'or credit it';
  ASSERT has_function_privilege('service_role', 'public.add_xp_day(text, text, integer)', 'EXECUTE'), 'the server credits it';
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_xp_days'::regclass), 'row level security is on';
END;
$$;
