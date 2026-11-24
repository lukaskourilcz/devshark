-- Migration 081: remove five covered indexes identified by F8-20 through F8-24.
-- Apply after 080, during a quiet window. An active reader or writer makes the
-- transaction refuse immediately. Retry the whole file when the tables are idle.
-- To roll back, recreate the original plain indexes during a maintenance window:
-- CREATE INDEX idx_matches_code ON public.matches USING btree (code);
-- CREATE INDEX idx_question_reports_question_id ON public.question_reports USING btree (question_id);
-- CREATE INDEX user_badges_user_subject_idx ON public.user_badges USING btree (user_id, subject);
-- CREATE INDEX user_cards_user_subject_idx ON public.user_cards USING btree (user_id, subject);
-- CREATE INDEX idx_user_stats_user_id ON public.user_stats USING btree (user_id);
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '3s';
SET LOCAL search_path = pg_catalog;

-- Hold the five parent tables across inspection and DROP. Another transaction
-- cannot replace an index or designate it for clustering between those steps.
LOCK TABLE public.matches, public.question_reports, public.user_badges,
           public.user_cards, public.user_stats IN ACCESS EXCLUSIVE MODE NOWAIT;

DO $migration$
DECLARE
  pair RECORD;
  old_oid OID;
  replacement_oid OID;
BEGIN
  FOR pair IN
    SELECT * FROM (VALUES
      ('matches', 'idx_matches_code', 'code', 'matches_code_key', 'code', 'u'),
      ('question_reports', 'idx_question_reports_question_id', 'question_id',
       'question_reports_item_version_idx', 'question_id, content_version', NULL),
      ('user_badges', 'user_badges_user_subject_idx', 'user_id, subject',
       'user_badges_pkey', 'user_id, subject, badge_id', 'p'),
      ('user_cards', 'user_cards_user_subject_idx', 'user_id, subject',
       'user_cards_pkey', 'user_id, subject, card_id', 'p'),
      ('user_stats', 'idx_user_stats_user_id', 'user_id', 'user_stats_user_id_key', 'user_id', 'u')
    ) AS expected(table_name, old_name, old_keys, replacement_name, replacement_keys, constraint_type)
  LOOP
    old_oid := to_regclass(format('public.%I', pair.old_name));
    replacement_oid := to_regclass(format('public.%I', pair.replacement_name));

    -- Compare the full deparsed definitions to the released originals.
    -- A partial index, included/expression key, different ordering, collation or
    -- opclass, or a coincidentally reused name must not qualify as a substitute.
    IF NOT EXISTS (
      SELECT FROM pg_index i
       WHERE i.indexrelid = replacement_oid
         AND i.indisvalid AND i.indisready AND i.indislive
         AND pg_get_indexdef(i.indexrelid) = format(
           'CREATE %sINDEX %I ON public.%I USING btree (%s)',
           CASE WHEN pair.constraint_type IS NULL THEN '' ELSE 'UNIQUE ' END,
           pair.replacement_name, pair.table_name, pair.replacement_keys)
         AND (pair.constraint_type IS NULL OR EXISTS (
           SELECT FROM pg_constraint c
            WHERE c.conrelid = i.indrelid AND c.conindid = i.indexrelid
              AND c.contype::text = pair.constraint_type AND c.convalidated))
    ) THEN
      RAISE EXCEPTION '081 requires the original usable covering index public.%', pair.replacement_name;
    END IF;

    IF old_oid IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT FROM pg_index i
         WHERE i.indexrelid = old_oid
           AND i.indisvalid AND i.indisready AND i.indislive
           AND NOT i.indisreplident AND NOT i.indisclustered
           AND NOT EXISTS (SELECT FROM pg_constraint c WHERE c.conindid = i.indexrelid)
           AND pg_get_indexdef(i.indexrelid) = format(
             'CREATE INDEX %I ON public.%I USING btree (%s)', pair.old_name, pair.table_name, pair.old_keys)
      ) THEN
        RAISE EXCEPTION '081 refuses changed or designated index public.%', pair.old_name;
      END IF;
      EXECUTE format('DROP INDEX public.%I RESTRICT', pair.old_name);
    END IF;
  END LOOP;
END;
$migration$;

COMMIT;
