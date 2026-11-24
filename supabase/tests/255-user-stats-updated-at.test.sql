-- The user_stats_touch_updated_at trigger (migration 002) sets updated_at on
-- every update of a user_stats row, whatever the update changes and whatever
-- search_path the writer's session has.

INSERT INTO public.user_stats (user_id, updated_at)
VALUES ('aaaaaaaa-0000-4000-8000-000000002551', TIMESTAMP '2000-01-01 00:00:00');

DO $$
DECLARE
  v_updated TIMESTAMP;
BEGIN
  PERFORM set_config('search_path', 'pg_catalog', TRUE);
  UPDATE public.user_stats SET total_quizzes = total_quizzes + 1
   WHERE user_id = 'aaaaaaaa-0000-4000-8000-000000002551'
  RETURNING updated_at INTO v_updated;
  ASSERT v_updated = now()::TIMESTAMP, format('updated_at after the update: %s, expected %s', v_updated, now()::TIMESTAMP);
END;
$$;
