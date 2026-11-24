-- 085 removes the historical unscoped indexes. The replacement access paths
-- still exist for the subject-scoped board and personal-card reads.
DO $$
DECLARE
  name TEXT;
BEGIN
  FOREACH name IN ARRAY ARRAY[
    'idx_user_stats_total_correct','idx_user_stats_last_quiz_date','idx_daily_attempts_date_score',
    'challenge_scores_top_idx','idx_flashcards_user','idx_user_category_stats_category_correct',
    'concept_reviews_due_idx','billing_events_unprocessed_idx','question_quality_suggestions_review_idx',
    'learning_path_attempts_expiry_idx'
  ] LOOP
    ASSERT to_regclass(format('public.%I', name)) IS NULL, format('085 must retire %s', name);
  END LOOP;
  FOREACH name IN ARRAY ARRAY['daily_attempts_subject_rank_idx','challenge_scores_subject_rank_idx','flashcards_user_subject_created_idx'] LOOP
    ASSERT EXISTS (SELECT FROM pg_index WHERE indexrelid = to_regclass(format('public.%I', name)) AND indisvalid AND indisready),
      format('subject-scoped reads still need %s', name);
  END LOOP;
END;
$$;
