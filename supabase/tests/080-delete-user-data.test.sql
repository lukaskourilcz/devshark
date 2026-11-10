-- Deleting an account leaves nothing that names it. The account is given a
-- row in every table that has an account column (found from the catalog, so a
-- new table must be seeded here before this test passes), mostly through the
-- routines the app itself calls. After delete_user_data no text or JSON value
-- in any public table contains its id, and the other accounts' own data stays.

-- The account is still in Auth while delete_user_data runs: the API deletes
-- the sign-in identity afterwards, and the billing writers refuse an id Auth
-- does not have (migration 053).
INSERT INTO auth.users (id) VALUES ('aaaaaaaa-0000-4000-8000-000000000080');

SET LOCAL ROLE service_role;

CREATE TEMP TABLE erasure_ids (name TEXT PRIMARY KEY, id TEXT NOT NULL) ON COMMIT DROP;
INSERT INTO erasure_ids VALUES
  ('gone',  'aaaaaaaa-0000-4000-8000-000000000080'),
  ('bob',   'aaaaaaaa-0000-4000-8000-000000000079'),
  ('carol', 'aaaaaaaa-0000-4000-8000-000000000082');

DO $$
DECLARE
  v_gone  CONSTANT TEXT := 'aaaaaaaa-0000-4000-8000-000000000080';
  v_bob   CONSTANT TEXT := 'aaaaaaaa-0000-4000-8000-000000000079';
  v_carol CONSTANT TEXT := 'aaaaaaaa-0000-4000-8000-000000000082';
  v_today CONSTANT DATE := (NOW() AT TIME ZONE 'UTC')::DATE;
  v_last_month CONSTANT DATE := (date_trunc('month', NOW() AT TIME ZONE 'UTC') - INTERVAL '1 month')::DATE;
  v_match UUID;
  v_bob_match UUID;
  v_status TEXT;
BEGIN
  -- Learning: quiz, daily, Learn level, skill check, coding, practice.
  PERFORM public.record_verified_quiz_result_v2(v_gone, 'eraseattempt00000001', 8, 10,
    '{"javascript":{"correct":8,"total":10}}',
    '[{"questionId":"q1","category":"javascript","isCorrect":true,"xp":4}]',
    'webdev', 80, 'gone@example.com', 'Gone Learner', NULL, v_today, 60000);
  PERFORM public.record_verified_quiz_result_v2(v_bob, 'eraseattempt00000002', 9, 10,
    '{"javascript":{"correct":9,"total":10}}', NULL, 'webdev', 90, 'bob@example.com', 'Bob');
  PERFORM public.claim_quiz_submission('erasegradekey0000001', 'eraseattempt00000009', v_gone, 'webdev', repeat('c', 64));
  PERFORM public.record_roadmap_answer_v2('eraselevel0000000001', v_gone, 'q1', 1, 1, 'webdev', 'html', 'level', 1, 1, 50);
  PERFORM public.record_coding_verdict(v_gone, 'erasecoding000001', 'js-double-numbers', 'javascript', 'passed', TRUE, 20, 'webdev', 'eraselevel0000000001');
  PERFORM public.complete_verified_roadmap_attempt_v2(v_gone, 'eraselevel0000000001');
  PERFORM public.apply_verified_skill_check(v_gone, 'eraseskill0000000001', 'webdev', 15, 20, '["css"]');
  PERFORM public.record_coding_reveal(v_gone, 'js-other-task', 'javascript', NULL);
  PERFORM public.save_coding_draft(v_gone, 'js-other-task', 'let x = 1;');
  PERFORM public.set_coding_bookmark(v_gone, 'js-double-numbers', TRUE);
  PERFORM public.upsert_coding_collection('erasecollection00001', v_gone, 'Favourites', 0);
  PERFORM public.set_coding_collection_item('erasecollection00001', v_gone, 'js-double-numbers', TRUE);
  PERFORM public.record_coding_skip(v_gone, 'js-hard-task', 'too-hard', 'later', 1);
  PERFORM public.record_coding_puzzle(v_gone, 'js-double-numbers', '["loops"]', TRUE);
  PERFORM public.start_practice_session_v2('erasesession00000001', v_gone, 'webdev', 15, NULL, '["js-double-numbers"]', 'random', 3, NOW() + INTERVAL '1 day');
  PERFORM public.record_concept_review_v2(v_gone, 'closures', 'webdev', 'erase-event-1', 1::SMALLINT, NOW() + INTERVAL '1 day', 1, 'q1', 'v1', 'independent', TRUE, 1, 0);
  PERFORM public.record_challenge_completion(v_gone, 'eraserun000000000001', 'webdev', 30, '{"javascript":{"correct":4,"total":7}}');
  PERFORM public.grant_daily_queue_cards(v_gone, 'webdev', v_today, '["card-a"]');
  PERFORM public.activate_streak_shield(v_gone);

  -- Learning paths and the finished-path package.
  PERFORM public.upsert_learning_path_enrollment(v_gone, 'eraseenroll000000001', 'dsa-foundations', 1, NULL, 'enroll');
  PERFORM public.open_learning_path_attempt(v_gone, 'erasepathattempt0001', 'eraseenroll000000001', 'dsa-arrays-1', 'exercise', 1, 1, 60);
  PERFORM public.accept_learning_path_result(v_gone, 'erasepathattempt0001', 'eraseidemkey00000001', 'eraserequest00000001', 'dsa-module-1',
    'verified_pass', 'machine_verified', 0.9, NULL, NULL, '{"code":"x"}', TRUE, '{"ok":true}');
  PERFORM public.save_learning_path_draft(v_gone, 'eraseenroll000000001', 'dsa-arrays-2', 0, '{"code":"y"}', 20);
  PERFORM public.claim_path_reward(v_gone, 'dsa-foundations', 1, 'M', 'Gone Learner', 'Street 1', NULL, 'Prague', '11000', 'CZ');

  -- Coins, the shop and merchandise, including a paid order that must stay
  -- (anonymised) for the shop's records.
  PERFORM public.grant_signup_tokens(v_gone, 'webdev', 500);
  PERFORM public.grant_signup_tokens(v_bob, 'webdev', 500);
  PERFORM public.credit_verified_xp_tokens(v_gone, 'quiz:eraseattempt00000001', 'webdev', 80, 0.1, 2, 400);
  PERFORM public.purchase_cosmetic(v_gone, 'crown', 'webdev', 50);
  PERFORM public.set_merch_stock('mug', '', 10);
  PERFORM public.create_merch_order('eraseorder0000000001', v_gone, 'tokens', '[{"sku":"mug","quantity":1,"unitTokens":100}]',
    NULL, NULL, 100, 'webdev', '{"name":"Gone","line1":"Street 1","city":"Prague","postalCode":"11000","country":"CZ"}', TRUE);
  PERFORM public.add_activity_day(v_gone, v_last_month, 'javascript', 40, 40);
  PERFORM public.settle_month_top3(TO_CHAR(v_last_month, 'YYYY-MM'), 'webdev', ARRAY[300, 200, 100], 5);

  -- People: handles, a friendship, a block, both sides of a referral. Bob's
  -- id sorts below the account's and carol's above, so the account is on
  -- both sides of the friendships table's (user_low, user_high) pair.
  PERFORM public.set_user_handle(v_gone, 'gone-learner');
  PERFORM public.set_user_handle(v_bob, 'bob-learner');
  PERFORM public.set_user_handle(v_carol, 'carol-learner');
  UPDATE public.user_handles SET discoverable=TRUE WHERE user_id IN(v_gone,v_bob);
  PERFORM public.request_friend(v_gone, 'bob-learner');
  PERFORM public.remove_friend(v_gone, 'carol-learner', TRUE);
  PERFORM public.referral_summary(v_bob);
  PERFORM public.referral_summary(v_gone);
  v_status := public.record_referral(v_gone, (SELECT code FROM public.referral_codes WHERE user_id = v_bob), NOW(), 48);
  ASSERT v_status = 'recorded', format('the account was invited by bob: %s', v_status);
  v_status := public.record_referral(v_carol, (SELECT code FROM public.referral_codes WHERE user_id = v_gone), NOW(), 48);
  ASSERT v_status = 'recorded', format('the account invited carol: %s', v_status);

  -- Premium: billing link, consent, a manual grant, a voucher redeemed and one
  -- created as an admin.
  PERFORM public.link_billing_customer(v_gone, 'cus_erase');
  PERFORM public.record_checkout_consent('cs_erase_1', v_gone, 'sub_erase', 'I waive', NOW());
  PERFORM public.grant_manual_entitlement(v_gone, NULL, 'test');
  PERFORM public.create_premium_voucher(repeat('8', 64), 'ERAS', 'erasure test voucher', 30, 5, NULL, v_gone);
  PERFORM public.redeem_premium_voucher(v_gone, repeat('8', 64));

  -- Tables the API writes directly.
  INSERT INTO public.user_badges (user_id, subject, badge_id) VALUES (v_gone, 'webdev', 'first-quiz');
  INSERT INTO public.flashcards (user_id, question_id, question, correct_answer) VALUES (v_gone, 'q1', 'Q?', 'A');
  INSERT INTO public.github_connections (user_id, installation_id, account_login, account_id) VALUES (v_gone, 1, 'gone', 1);
  INSERT INTO public.github_commits (user_id, task_id, path) VALUES (v_gone, 'js-double-numbers', 'a.js');
  INSERT INTO public.question_reports (question_id, reason, reporter_sub) VALUES ('q1', 'wrong', v_gone);
  INSERT INTO public.auth_events (user_id, email, event_type) VALUES (v_gone, 'gone@example.com', 'register');
  INSERT INTO public.challenge_scores (user_id, name, score, run_id) VALUES (v_gone, 'Gone', 5, 'eraserun000000000001');
  INSERT INTO public.user_streak_config (user_id) VALUES (v_gone);
  INSERT INTO public.matches (code, mode, host_id, questions) VALUES ('ERASE1', 'multiplayer', v_gone, '[{"q":"x","correctIndex":1}]')
    RETURNING id INTO v_match;
  INSERT INTO public.matches (code, mode, host_id, questions) VALUES ('ERASE2', 'multiplayer', v_bob, '[{"q":"x","correctIndex":1}]')
    RETURNING id INTO v_bob_match;
  INSERT INTO public.match_participants (match_id, user_id, display_name)
    VALUES (v_match, v_gone, 'Gone'), (v_bob_match, v_gone, 'Gone'), (v_bob_match, v_bob, 'Bob');
  INSERT INTO public.match_answers (match_id, user_id, question_id, question_idx, selected_idx, is_correct)
    VALUES (v_bob_match, v_gone, 'q', 0, 1, TRUE), (v_bob_match, v_bob, 'q', 0, 1, TRUE);
END;
$$;

-- Every account column holds the account before the erasure, so the check
-- below covers every table that can name it.
DO $$
DECLARE
  v_gone CONSTANT TEXT := (SELECT id FROM erasure_ids WHERE name = 'gone');
  r RECORD;
  v_count BIGINT;
  v_unseeded TEXT := NULL;
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name
      FROM information_schema.columns c
      JOIN pg_class t ON t.relname = c.table_name AND t.relnamespace = 'public'::regnamespace AND t.relkind IN ('r', 'p')
     WHERE c.table_schema = 'public'
       AND c.data_type IN ('text', 'character varying')
       AND c.column_name ~ '^(user_id|user_low|user_high|host_id)$|_user_id$|_by$|_sub$'
     ORDER BY 1, 2
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = $1', r.table_name, r.column_name) INTO v_count USING v_gone;
    IF v_count = 0 THEN
      v_unseeded := concat_ws(', ', v_unseeded, r.table_name || '.' || r.column_name);
    END IF;
  END LOOP;
  ASSERT v_unseeded IS NULL,
    format('seed a row naming the account in %s so this test proves delete_user_data clears it', v_unseeded);
END;
$$;

DO $$
BEGIN
  PERFORM public.delete_user_data((SELECT id FROM erasure_ids WHERE name = 'gone'));
END;
$$;

DO $$
DECLARE
  v_gone CONSTANT TEXT := (SELECT id FROM erasure_ids WHERE name = 'gone');
  v_bob  CONSTANT TEXT := (SELECT id FROM erasure_ids WHERE name = 'bob');
  r RECORD;
  v_count BIGINT;
  v_left TEXT := NULL;
  v_paid TEXT;
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name
      FROM information_schema.columns c
      JOIN pg_class t ON t.relname = c.table_name AND t.relnamespace = 'public'::regnamespace AND t.relkind IN ('r', 'p')
     WHERE c.table_schema = 'public'
       AND c.data_type IN ('text', 'character varying', 'jsonb', 'json')
     ORDER BY 1, 2
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE strpos(%I::TEXT, $1) > 0', r.table_name, r.column_name)
      INTO v_count USING v_gone;
    IF v_count > 0 THEN
      v_left := concat_ws(', ', v_left, format('%s.%s (%s rows)', r.table_name, r.column_name, v_count));
    END IF;
  END LOOP;
  ASSERT v_left IS NULL, format('delete_user_data left the account''s id in %s', v_left);

  -- The paid order stays for the shop's records, without the person.
  SELECT user_id || '/' || ship_name INTO v_paid FROM public.merch_orders WHERE order_id = 'eraseorder0000000001';
  ASSERT v_paid = 'deleted-account/redacted', format('a paid order stays, anonymised: %s', v_paid);

  -- Another account's own data is untouched.
  ASSERT EXISTS (SELECT 1 FROM public.user_stats WHERE user_id = v_bob), 'the other account keeps its stats';
  ASSERT EXISTS (SELECT 1 FROM public.user_xp WHERE user_id = v_bob AND quest_xp = 90), 'the other account keeps its XP';
  ASSERT EXISTS (SELECT 1 FROM public.token_balances WHERE user_id = v_bob), 'the other account keeps its coins';
  ASSERT EXISTS (SELECT 1 FROM public.user_handles WHERE user_id = v_bob), 'the other account keeps its handle';
  ASSERT EXISTS (SELECT 1 FROM public.matches WHERE host_id = v_bob), 'the other account keeps the match it hosts';
  ASSERT EXISTS (SELECT 1 FROM public.match_answers WHERE user_id = v_bob), 'the other account keeps its match answers';
END;
$$;
