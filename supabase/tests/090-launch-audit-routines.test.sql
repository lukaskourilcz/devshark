-- The routines migration 047 corrected, each held to the behaviour a learner
-- relies on: a block stays with whoever set it, a daily started before
-- midnight still counts, only Google avatars reach the public boards, badges
-- sync, a revealed coding task does not complete a Learn level, a pack with a
-- repeated card can be claimed, a friend's streak is the live one, and the
-- first verified daily result stands.

SET LOCAL ROLE service_role;

-- A block belongs to whoever set it: the blocked account can neither take it
-- over nor lift it.
DO $$
DECLARE
  v_dora CONSTANT TEXT := 'aaaaaaaa-0000-4000-8000-000000000901';
  v_eve  CONSTANT TEXT := 'aaaaaaaa-0000-4000-8000-000000000902';
BEGIN
  PERFORM public.set_user_handle(v_dora, 'dora-090');
  PERFORM public.set_user_handle(v_eve, 'eve-090');
  PERFORM public.remove_friend(v_dora, 'eve-090', TRUE);

  PERFORM public.remove_friend(v_eve, 'dora-090', TRUE);
  ASSERT (SELECT count(*) FROM public.friendships WHERE v_dora IN (user_low, user_high) AND state = 'blocked') = 2,
    'blocking back preserves both directional blocks';

  ASSERT public.remove_friend(v_eve, 'dora-090', FALSE), 'Eve can lift her own block';
  ASSERT NOT public.remove_friend(v_eve, 'dora-090', FALSE), 'Eve cannot lift Dora’s block';
  ASSERT EXISTS (SELECT 1 FROM public.friendships WHERE v_dora IN (user_low, user_high) AND blocked_by = v_dora),
    'Dora’s block is still there';
END;
$$;

-- Through the Data API the blocked account does not see the block. auth.uid()
-- reads request.jwt.claims on Supabase and request.jwt.claim.sub on older
-- images, so both are set.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000902","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000902', true);
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.friendships) = 0, 'the blocked party reads no friendship row';
END;
$$;
SELECT set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000901","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000901', true);
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.friendships) = 1, 'the blocker still reads their block';
END;
$$;
SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SET LOCAL ROLE service_role;

-- A daily started before 00:00 UTC and submitted after it is yesterday's
-- daily, accepted for two hours after midnight and refused after that.
DO $$
DECLARE
  v_user CONSTANT TEXT := 'aaaaaaaa-0000-4000-8000-000000000903';
  v_today DATE := (NOW() AT TIME ZONE 'UTC')::DATE;
  v_in_grace BOOLEAN := NOW() < (v_today::TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '2 hours';
  v_recorded BOOLEAN;
BEGIN
  BEGIN
    v_recorded := public.record_verified_quiz_result_v2(v_user, 'dailyattempt0000903', 4, 5,
      '{"javascript":{"correct":4,"total":5}}', NULL, 'webdev', 40, NULL, NULL, NULL, v_today - 1, 60000);
  EXCEPTION WHEN OTHERS THEN
    ASSERT NOT v_in_grace, format('yesterday''s daily is accepted within two hours of midnight: %s', SQLERRM);
    ASSERT SQLERRM LIKE '%invalid_daily_date%', format('outside the grace it is refused as invalid_daily_date: %s', SQLERRM);
    v_recorded := NULL;
  END;
  IF v_in_grace THEN
    ASSERT v_recorded IS TRUE, 'within the grace the result is recorded';
  END IF;
  -- Today's daily is always accepted.
  v_recorded := public.record_verified_quiz_result_v2(v_user, 'dailyattempt0000904', 3, 5,
    '{"javascript":{"correct":3,"total":5}}', NULL, 'webdev', 30, NULL, NULL, NULL, v_today, 50000);
  ASSERT v_recorded IS TRUE, 'today''s daily is recorded';
END;
$$;

-- The first verified daily result stands: a later receipt for the same day
-- neither replaces the score on the Today board nor pays again.
DO $$
DECLARE
  v_user CONSTANT TEXT := 'aaaaaaaa-0000-4000-8000-000000000905';
  v_today DATE := (NOW() AT TIME ZONE 'UTC')::DATE;
  v_first BOOLEAN;
  v_second BOOLEAN;
  v_correct INTEGER;
  v_duration INTEGER;
BEGIN
  v_first := public.record_verified_quiz_result_v2(v_user, 'dailyattempt0000905', 2, 5,
    '{"javascript":{"correct":2,"total":5}}', NULL, 'webdev', 20, NULL, NULL, NULL, v_today, 90000);
  v_second := public.record_verified_quiz_result_v2(v_user, 'dailyattempt0000906', 5, 5,
    '{"javascript":{"correct":5,"total":5}}', NULL, 'webdev', 50, NULL, NULL, NULL, v_today, 3000);
  SELECT correct, duration_ms INTO v_correct, v_duration FROM public.daily_attempts
   WHERE user_id = v_user AND challenge_date = v_today AND subject = 'webdev';
  ASSERT v_first IS TRUE AND v_second IS FALSE, format('first recorded, second refused (got %s, %s)', v_first, v_second);
  ASSERT v_correct = 2 AND v_duration = 90000, format('the board keeps the first result: 2 in 90000 ms, got %s in %s', v_correct, v_duration);
END;
$$;

-- Only a Google avatar is stored for the public boards.
DO $$
DECLARE
  v_picture TEXT;
BEGIN
  INSERT INTO public.user_stats (user_id, name, picture)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000907', 'Tracker', 'https://evil.example/pixel.gif');
  SELECT picture INTO v_picture FROM public.user_stats WHERE user_id = 'aaaaaaaa-0000-4000-8000-000000000907';
  ASSERT v_picture IS NULL, format('a picture from another host is dropped, got %s', v_picture);

  UPDATE public.user_stats SET picture = 'https://lh3.googleusercontent.com/a/avatar'
   WHERE user_id = 'aaaaaaaa-0000-4000-8000-000000000907';
  SELECT picture INTO v_picture FROM public.user_stats WHERE user_id = 'aaaaaaaa-0000-4000-8000-000000000907';
  ASSERT v_picture = 'https://lh3.googleusercontent.com/a/avatar', format('a Google avatar is kept, got %s', v_picture);
END;
$$;

-- Badges sync instead of raising.
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT count(*) INTO v_count FROM public.sync_user_badges('aaaaaaaa-0000-4000-8000-000000000908', 'webdev', '["first-quiz"]');
  ASSERT v_count = 1, format('the badge is stored and returned, got %s rows', v_count);
  SELECT count(*) INTO v_count FROM public.sync_user_badges('aaaaaaaa-0000-4000-8000-000000000908', 'webdev', '["first-quiz"]');
  ASSERT v_count = 1, format('syncing it again keeps one row, got %s', v_count);
END;
$$;

-- A coding task whose solution was revealed in the attempt does not complete
-- the Learn level, even after a passing verdict.
DO $$
DECLARE
  v_user CONSTANT TEXT := 'aaaaaaaa-0000-4000-8000-000000000909';
  v_attempt CONSTANT TEXT := 'learnattempt00000909';
  v_passed BOOLEAN;
BEGIN
  PERFORM public.record_roadmap_answer_v2(v_attempt, v_user, 'q1', 1, 1, 'webdev', 'javascript', 'level', 1, 1, 75, NULL, NULL);
  PERFORM public.record_coding_reveal(v_user, 'js-double-numbers', 'javascript', v_attempt);
  PERFORM public.record_coding_verdict(v_user, 'codingattempt000909', 'js-double-numbers', 'javascript', 'passed', TRUE, 20,
    'webdev', v_attempt, 1000, 1, 0, 'copied');
  PERFORM public.complete_verified_roadmap_attempt(v_user, v_attempt, '["js-double-numbers"]');
  SELECT (data #>> '{javascript,levels,1,passed}')::BOOLEAN INTO v_passed FROM public.roadmap_progress WHERE user_id = v_user;
  ASSERT v_passed IS FALSE, format('a revealed task leaves the level not passed, got %s', v_passed);
END;
$$;

-- A daily pack that holds the same card twice is granted, and counts it twice.
DO $$
DECLARE
  v_status TEXT;
  v_count INTEGER;
BEGIN
  SELECT status INTO v_status FROM public.grant_daily_queue_cards('aaaaaaaa-0000-4000-8000-000000000910', 'webdev',
    (NOW() AT TIME ZONE 'UTC')::DATE, '["webdev-topic-html","webdev-topic-html","webdev-topic-react"]');
  SELECT count INTO v_count FROM public.user_cards
   WHERE user_id = 'aaaaaaaa-0000-4000-8000-000000000910' AND card_id = 'webdev-topic-html';
  ASSERT v_status = 'granted' AND v_count = 2, format('the pack is granted with the repeat counted: %s, %s', v_status, v_count);
END;
$$;

-- A friend's streak is the live one: a streak that ended days ago shows 0,
-- one active yesterday still shows its length.
DO $$
DECLARE
  v_me CONSTANT TEXT := 'aaaaaaaa-0000-4000-8000-000000000911';
  v_gone CONSTANT TEXT := 'aaaaaaaa-0000-4000-8000-000000000912';
  v_here CONSTANT TEXT := 'aaaaaaaa-0000-4000-8000-000000000913';
  v_today DATE := (NOW() AT TIME ZONE 'UTC')::DATE;
  v_gone_streak INTEGER;
  v_here_streak INTEGER;
BEGIN
  PERFORM public.set_user_handle(v_me, 'me-090');
  PERFORM public.set_user_handle(v_gone, 'gone-090');
  PERFORM public.set_user_handle(v_here, 'here-090');
  PERFORM public.request_friend(v_me, 'gone-090');
  PERFORM public.respond_friend(v_gone, 'me-090', TRUE);
  PERFORM public.request_friend(v_me, 'here-090');
  PERFORM public.respond_friend(v_here, 'me-090', TRUE);
  INSERT INTO public.user_stats (user_id, current_streak, longest_streak, last_quiz_date)
  VALUES (v_gone, 12, 12, v_today - 10), (v_here, 7, 7, v_today - 1);
  SELECT current_streak INTO v_gone_streak FROM public.friend_list(v_me, ARRAY['javascript']) WHERE handle = 'gone-090';
  SELECT current_streak INTO v_here_streak FROM public.friend_list(v_me, ARRAY['javascript']) WHERE handle = 'here-090';
  ASSERT v_gone_streak = 0, format('a streak last kept ten days ago shows 0, got %s', v_gone_streak);
  ASSERT v_here_streak = 7, format('a streak kept yesterday still shows 7, got %s', v_here_streak);
END;
$$;
