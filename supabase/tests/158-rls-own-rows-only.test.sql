-- What the browser roles can read, not only that row level security is on
-- (010-schema-security.test.sql; review finding TEST-4). Every policy for
-- anon, authenticated or public is a read of the caller's own rows, and it
-- behaves that way: a signed-out visitor reads no learner's rows, and a
-- signed-in learner reads their own and nobody else's. A policy such as
-- USING (true) on user_stats passed every test before this one.

-- Two learners with data in the own-row tables, written the way the server
-- writes it. Written as the owner, which row level security does not filter.
DO $$
DECLARE
  v_today CONSTANT DATE := (NOW() AT TIME ZONE 'UTC')::DATE;
  v_user  TEXT;
  v_n     INTEGER := 0;
BEGIN
  FOREACH v_user IN ARRAY ARRAY['aaaaaaaa-0000-4000-8000-000000001801', 'aaaaaaaa-0000-4000-8000-000000001802'] LOOP
    v_n := v_n + 1;
    PERFORM public.record_verified_quiz_result_v2(
      v_user, 'rlsownrowsquiz0000' || v_n, 1, 1, NULL,
      '[{"questionId":"q1","category":"javascript","isCorrect":true,"xp":4}]', 'webdev', 4);
    PERFORM public.record_verified_quiz_result_v2(
      v_user, 'rlsownrowsdaily000' || v_n, 1, 1, NULL,
      '[{"questionId":"q2","category":"javascript","isCorrect":true,"xp":4}]', 'webdev', 20,
      NULL, NULL, NULL, v_today, 60000);
    PERFORM public.activate_streak_shield(v_user);
    PERFORM public.record_coding_verdict(v_user, 'rlsownrowscoding' || v_n, 'js-double-numbers', 'javascript', 'passed', TRUE, 20);
    PERFORM public.record_roadmap_answer_v2('rlsownrowslearn0000' || v_n, v_user, 'q1', 1, 1, 'webdev', 'html', 'level', 1, 1, 50);
    PERFORM public.complete_verified_roadmap_attempt(v_user, 'rlsownrowslearn0000' || v_n);
    PERFORM public.grant_signup_tokens(v_user, 'webdev', 100);
    PERFORM public.set_user_handle(v_user, 'rls-own-rows-' || v_n);
    PERFORM public.upsert_coding_collection('rlsownrowscollect' || v_n, v_user, 'Favourites', 0);
    PERFORM public.set_coding_collection_item('rlsownrowscollect' || v_n, v_user, 'js-double-numbers', TRUE);
  END LOOP;
  -- A friendship between two other learners.
  PERFORM public.set_user_handle('aaaaaaaa-0000-4000-8000-000000001803', 'rls-own-rows-3');
  PERFORM public.set_user_handle('aaaaaaaa-0000-4000-8000-000000001804', 'rls-own-rows-4');
  PERFORM public.request_friend('aaaaaaaa-0000-4000-8000-000000001803', 'rls-own-rows-4');
  PERFORM public.respond_friend('aaaaaaaa-0000-4000-8000-000000001804', 'rls-own-rows-3', TRUE);
END;
$$;

-- Every policy a browser role can use is a read limited to the caller.
DO $$
DECLARE
  v_bad TEXT;
BEGIN
  SELECT string_agg(format('%s.%s (%s)', p.tablename, p.policyname, p.cmd), ', ' ORDER BY 1) INTO v_bad
    FROM pg_policies p
   WHERE p.schemaname = 'public'
     AND p.roles && ARRAY['anon', 'authenticated', 'public']::NAME[]
     AND (p.cmd <> 'SELECT' OR p.qual IS NULL OR p.qual !~ 'auth\.uid\(\)');
  ASSERT v_bad IS NULL, format('browser policies that are not a read of the caller''s own rows: %s', v_bad);
END;
$$;

-- The same, observed. Each table with a browser policy is read three ways:
-- by the owner (everything), as anon (nothing) and as learner A (only A's).
DO $$
DECLARE
  v_a       CONSTANT TEXT := 'aaaaaaaa-0000-4000-8000-000000001801';
  v_b       CONSTANT TEXT := 'aaaaaaaa-0000-4000-8000-000000001802';
  v_table   TEXT;
  v_owner   TEXT;
  v_all     INTEGER;
  v_seen    INTEGER;
  v_foreign INTEGER;
  v_bad     TEXT[] := '{}';
  v_checked TEXT[] := '{}';
  v_seeded  TEXT[] := '{}';
BEGIN
  FOR v_table, v_owner IN
    SELECT DISTINCT p.tablename::TEXT,
           CASE
             WHEN EXISTS (SELECT 1 FROM information_schema.columns c
                           WHERE c.table_schema = 'public' AND c.table_name = p.tablename AND c.column_name = 'user_id')
               THEN 'user_id'
             WHEN p.tablename = 'friendships' THEN 'party'
             ELSE NULL
           END
      FROM pg_policies p
     WHERE p.schemaname = 'public'
       AND p.roles && ARRAY['anon', 'authenticated', 'public']::NAME[]
     ORDER BY 1
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', v_table) INTO v_all;
    IF v_all > 0 THEN v_seeded := v_seeded || v_table; END IF;

    -- Signed out.
    PERFORM set_config('request.jwt.claim.sub', '', TRUE);
    PERFORM set_config('request.jwt.claims', '', TRUE);
    PERFORM set_config('role', 'anon', TRUE);
    IF has_table_privilege('anon', format('public.%I', v_table), 'SELECT') THEN
      EXECUTE format('SELECT count(*) FROM public.%I', v_table) INTO v_seen;
      IF v_seen > 0 THEN v_bad := v_bad || format('%s: anon reads %s rows', v_table, v_seen); END IF;
    END IF;

    -- Signed in as A, with both settings auth.uid() may read.
    PERFORM set_config('role', 'authenticated', TRUE);
    PERFORM set_config('request.jwt.claim.sub', v_a, TRUE);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::TEXT, TRUE);
    IF has_table_privilege('authenticated', format('public.%I', v_table), 'SELECT') THEN
      IF v_owner = 'user_id' THEN
        EXECUTE format('SELECT count(*) FILTER (WHERE user_id IS DISTINCT FROM $1) FROM public.%I', v_table)
          INTO v_foreign USING v_a;
      ELSIF v_owner = 'party' THEN
        EXECUTE 'SELECT count(*) FILTER (WHERE $1 NOT IN (user_low, user_high)) FROM public.friendships'
          INTO v_foreign USING v_a;
      ELSE
        -- Rows owned through a parent (coding_collection_items,
        -- merch_order_items): A owns one collection and no order, so A may
        -- read at most the one item in A's collection.
        EXECUTE format('SELECT GREATEST(count(*) - 1, 0) FROM public.%I', v_table) INTO v_foreign;
      END IF;
      IF v_foreign > 0 THEN v_bad := v_bad || format('%s: learner A reads %s rows of others', v_table, v_foreign); END IF;
      v_checked := v_checked || v_table;
    END IF;
    PERFORM set_config('role', 'none', TRUE);
  END LOOP;

  PERFORM set_config('request.jwt.claim.sub', '', TRUE);
  PERFORM set_config('request.jwt.claims', '', TRUE);
  ASSERT cardinality(v_bad) = 0, format('rows the browser roles can read that are not theirs: %s', v_bad);

  -- Not vacuous: the tables learners read most hold both learners' rows, and
  -- A can read A's own.
  ASSERT v_seeded @> ARRAY['user_stats', 'user_xp', 'user_category_stats', 'user_activity_days',
                           'roadmap_progress', 'daily_attempts', 'token_balances',
                           'user_handles', 'friendships', 'coding_collections', 'coding_collection_items'],
    format('the seeded tables: %s', v_seeded);
  ASSERT v_checked @> ARRAY['user_stats', 'user_category_stats', 'user_xp', 'user_activity_days', 'token_balances'],
    format('the tables read as learner A: %s', v_checked);
  PERFORM set_config('role', 'authenticated', TRUE);
  PERFORM set_config('request.jwt.claim.sub', v_a, TRUE);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::TEXT, TRUE);
  SELECT count(*) INTO v_seen FROM public.user_stats;
  PERFORM set_config('role', 'none', TRUE);
  ASSERT v_seen = 1, format('learner A reads exactly their own stats row: %s', v_seen);
  SELECT count(*) INTO v_all FROM public.user_stats WHERE user_id = v_b;
  ASSERT v_all = 1, 'learner B''s row is there to be hidden';
END;
$$;
