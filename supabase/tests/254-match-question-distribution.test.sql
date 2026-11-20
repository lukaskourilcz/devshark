-- The answer histogram a host reads after a match (api/play/[action].ts,
-- the distribution action) comes from match_question_distribution, which the
-- server calls with the service role. Per question it counts the answers on
-- each option and says whether that option was right. The browser roles cannot
-- call it: the correctness flags would leak the answers.

INSERT INTO public.matches (id, code, mode, host_id, status, questions)
VALUES ('aaaaaaaa-0000-4000-8000-000000002541', 'F8DIST254', 'multiplayer',
        'aaaaaaaa-0000-4000-8000-000000002540', 'finished', '[{"id":"q0"},{"id":"q1"}]');
INSERT INTO public.match_answers (match_id, user_id, question_id, question_idx, selected_idx, is_correct) VALUES
  ('aaaaaaaa-0000-4000-8000-000000002541', 'aaaaaaaa-0000-4000-8000-000000002542', 'q0', 0, 1, TRUE),
  ('aaaaaaaa-0000-4000-8000-000000002541', 'aaaaaaaa-0000-4000-8000-000000002543', 'q0', 0, 1, TRUE),
  ('aaaaaaaa-0000-4000-8000-000000002541', 'aaaaaaaa-0000-4000-8000-000000002544', 'q0', 0, 3, FALSE),
  ('aaaaaaaa-0000-4000-8000-000000002541', 'aaaaaaaa-0000-4000-8000-000000002542', 'q1', 1, 0, FALSE);

DO $$
DECLARE
  v_routine CONSTANT REGPROCEDURE := 'public.match_question_distribution(uuid,integer)';
BEGIN
  ASSERT NOT has_function_privilege('anon', v_routine, 'EXECUTE'), 'anon can read the answer distribution';
  ASSERT NOT has_function_privilege('authenticated', v_routine, 'EXECUTE'), 'authenticated can read the answer distribution';
  ASSERT has_function_privilege('service_role', v_routine, 'EXECUTE'), 'the server cannot read the answer distribution';
END;
$$;

SET LOCAL ROLE service_role;
DO $$
DECLARE
  v_buckets TEXT;
BEGIN
  -- An unrelated search_path in the caller's session changes nothing.
  PERFORM set_config('search_path', 'pg_catalog', TRUE);
  SELECT string_agg(format('%s:%s:%s', d.selected_idx, d.count, d.correct), ' ' ORDER BY d.selected_idx) INTO v_buckets
    FROM public.match_question_distribution('aaaaaaaa-0000-4000-8000-000000002541', 0) d;
  ASSERT v_buckets = '1:2:t 3:1:f', format('question 0 buckets: %s', v_buckets);

  SELECT string_agg(format('%s:%s:%s', d.selected_idx, d.count, d.correct), ' ' ORDER BY d.selected_idx) INTO v_buckets
    FROM public.match_question_distribution('aaaaaaaa-0000-4000-8000-000000002541', 1) d;
  ASSERT v_buckets = '0:1:f', format('question 1 buckets: %s', v_buckets);

  SELECT string_agg(format('%s:%s:%s', d.selected_idx, d.count, d.correct), ' ') INTO v_buckets
    FROM public.match_question_distribution('aaaaaaaa-0000-4000-8000-000000002541', 2) d;
  ASSERT v_buckets IS NULL, format('a question nobody answered has no buckets: %s', v_buckets);
END;
$$;
RESET ROLE;
