-- Migration 080: index the case-insensitive name check in allocate_shark_name.
-- Apply after 079. The lookup runs while holding the global name counter.
-- A normal index build leaves reads available but holds off writes until commit.
-- Acquire the lock immediately or leave the table untouched. Retry during a
-- quiet window. The build itself has a three-second bound.
-- On a larger table an operator may first build this same index CONCURRENTLY
-- outside a transaction and then run this file to verify the completed index.
-- To revert, drop only public.challenge_scores_lower_name_idx.
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '3s';

LOCK TABLE public.challenge_scores IN SHARE MODE NOWAIT;
CREATE INDEX IF NOT EXISTS challenge_scores_lower_name_idx
  ON public.challenge_scores USING btree (lower(name));

-- IF NOT EXISTS also skips an invalid index left by an interrupted concurrent
-- build, or a different index with the same name. Refuse either state.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
    JOIN pg_catalog.pg_am a ON a.oid = c.relam
    WHERE i.indexrelid = 'public.challenge_scores_lower_name_idx'::regclass
      AND i.indrelid = 'public.challenge_scores'::regclass
      AND i.indisvalid AND i.indisready AND a.amname = 'btree'
      AND i.indnatts = 1 AND i.indpred IS NULL
      AND pg_catalog.pg_get_indexdef(i.indexrelid, 1, true) = 'lower(name)'
  ) THEN
    RAISE EXCEPTION 'migration 080 requires a valid btree index on challenge_scores (lower(name))';
  END IF;
END;
$$;
COMMIT;
