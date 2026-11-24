-- The global handle allocator checks existing Challenge names without regard
-- to case. Its expression stays indexable as data grows. Ordinary score and
-- subject indexes cannot support this lookup.
DO $$
DECLARE
  v_plan JSONB;
BEGIN
  SET LOCAL enable_seqscan = off;
  EXECUTE $query$EXPLAIN (FORMAT JSON, COSTS FALSE)
    SELECT 1 FROM public.challenge_scores c
    WHERE lower(c.name) = lower('fixtureNewHandle42')
      AND NOT coalesce(c.user_id = 'fixture-account', FALSE)$query$ INTO v_plan;
  ASSERT v_plan::text LIKE '%"Index Name": "challenge_scores_lower_name_idx"%',
    'allocate_shark_name needs an indexable case-insensitive score-name lookup';
END;
$$;
