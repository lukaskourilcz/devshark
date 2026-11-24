-- Migration 085: retire ten old secondary indexes after migration 084.
-- Apply in a quiet window. These are ordinary indexes; no row is changed.
-- The original keys and predicates below also provide their rollback definitions.
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL search_path = pg_catalog;

LOCK TABLE public.billing_events, public.challenge_scores, public.concept_reviews,
           public.daily_attempts, public.flashcards, public.learning_path_attempts,
           public.question_quality_suggestions, public.user_category_stats, public.user_stats
  IN ACCESS EXCLUSIVE MODE NOWAIT;

DO $indexes$
DECLARE
  target RECORD;
  idx REGCLASS;
BEGIN
  FOR target IN SELECT * FROM (VALUES
    ('daily_attempts', 'daily_attempts_subject_rank_idx', 'challenge_date, subject, correct DESC, duration_ms'),
    ('challenge_scores', 'challenge_scores_subject_rank_idx', 'subject, score DESC, created_at'),
    ('flashcards', 'flashcards_user_subject_created_idx', 'user_id, subject, created_at DESC')
  ) AS replacement(parent, name, keys) LOOP
    IF NOT EXISTS (SELECT FROM pg_index i
                    WHERE i.indexrelid = to_regclass(format('public.%I', target.name))
                      AND i.indisvalid AND i.indisready AND i.indislive
                      AND pg_get_indexdef(i.indexrelid) = format('CREATE INDEX %I ON public.%I USING btree (%s)',
                        target.name, target.parent, target.keys)) THEN
      RAISE EXCEPTION '085 requires the original usable subject-scoped index public.%', target.name;
    END IF;
  END LOOP;
  FOR target IN SELECT * FROM (VALUES
    ('user_stats', 'idx_user_stats_total_correct', 'total_correct DESC', '(total_quizzes > 0)'),
    ('user_stats', 'idx_user_stats_last_quiz_date', 'last_quiz_date', NULL),
    ('daily_attempts', 'idx_daily_attempts_date_score', 'challenge_date, correct DESC, duration_ms', NULL),
    ('challenge_scores', 'challenge_scores_top_idx', 'score DESC, created_at', NULL),
    ('flashcards', 'idx_flashcards_user', 'user_id, created_at DESC', NULL),
    ('user_category_stats', 'idx_user_category_stats_category_correct', 'category, total_correct DESC', '(total_questions > 0)'),
    ('concept_reviews', 'concept_reviews_due_idx', 'user_id, due_at', '(due_at IS NOT NULL)'),
    ('billing_events', 'billing_events_unprocessed_idx', 'received_at', '(processed_at IS NULL)'),
    ('question_quality_suggestions', 'question_quality_suggestions_review_idx', 'status, created_at DESC', '(status = ''pending''::text)'),
    ('learning_path_attempts', 'learning_path_attempts_expiry_idx', 'expires_at', '(state = ''open''::text)')
  ) AS expected(parent, name, keys, predicate)
  LOOP
    idx := to_regclass(format('public.%I', target.name));
    IF idx IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (
      SELECT FROM pg_index i
       WHERE i.indexrelid = idx
         AND i.indisvalid AND i.indisready AND i.indislive
         AND NOT i.indisreplident AND NOT i.indisclustered
         AND NOT EXISTS (SELECT FROM pg_constraint c WHERE c.conindid = idx)
         AND pg_get_indexdef(idx) = format('CREATE INDEX %I ON public.%I USING btree (%s)%s',
           target.name, target.parent, target.keys,
           CASE WHEN target.predicate IS NULL THEN '' ELSE ' WHERE ' || target.predicate END)
    ) THEN
      RAISE EXCEPTION '085 refuses to drop changed or designated index %', idx;
    END IF;
    EXECUTE format('DROP INDEX public.%I', target.name);
  END LOOP;
END;
$indexes$;
COMMIT;
