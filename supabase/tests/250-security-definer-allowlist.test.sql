-- Every routine in the application schemas runs on an empty search_path, and
-- the browser roles execute an application routine only when it is on the
-- allow-list below. 010-schema-security.test.sql looks at public alone and
-- accepts search_path=public; this file also covers devshark_private and
-- holds every routine, definer or invoker, to search_path="".
--
-- The scope is the two schemas the migrations own. The supabase/postgres image
-- that CI runs ships definer routines of its own in extensions, pgbouncer,
-- graphql and vault, which a bare Postgres lacks, so a catalog-wide scan would
-- pass on one and fail on the other. Routines an extension installs are left
-- out for the same reason.

-- The checks, as one function the self-check below and the real check share.
CREATE FUNCTION pg_temp.definer_violations(p_allowed TEXT[])
RETURNS TEXT[] LANGUAGE sql STABLE AS $$
  WITH routine AS (
    SELECT p.oid, p.prosecdef, p.proconfig,
           format('%s.%s(%s)', n.nspname, p.proname, pg_catalog.oidvectortypes(p.proargtypes)) AS name
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = ANY (ARRAY['public', 'devshark_private'])
       AND p.prokind IN ('f', 'p')
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_depend d
          WHERE d.classid = 'pg_catalog.pg_proc'::REGCLASS AND d.objid = p.oid AND d.deptype = 'e'
       )
  ),
  browser AS (
    SELECT r.*, (pg_catalog.has_function_privilege('anon', r.oid, 'EXECUTE')
                 OR pg_catalog.has_function_privilege('authenticated', r.oid, 'EXECUTE')) AS executable
      FROM routine r
  ),
  allowed AS (
    SELECT a.entry, pg_catalog.to_regprocedure(a.entry)::OID AS oid FROM unnest(p_allowed) AS a(entry)
  ),
  violation(line) AS (
    SELECT 'browser roles execute routine ' || b.name
      FROM browser b
     WHERE b.executable
       AND b.oid NOT IN (SELECT a.oid FROM allowed a WHERE a.oid IS NOT NULL)
    UNION ALL
    SELECT 'missing caller comment on ' || r.name FROM routine r
     WHERE r.prosecdef AND nullif(btrim(pg_catalog.obj_description(r.oid, 'pg_proc')), '') IS NULL
    UNION ALL
    SELECT 'search_path is not "" on ' || r.name || ' (' || coalesce(array_to_string(r.proconfig, ' '), 'not set') || ')'
      FROM routine r
     WHERE NOT ('search_path=""' = ANY (coalesce(r.proconfig, '{}')))
    UNION ALL
    SELECT 'stale allow-list entry ' || a.entry
      FROM allowed a
      LEFT JOIN browser b ON b.oid = a.oid
     WHERE b.oid IS NULL OR NOT b.prosecdef OR NOT b.executable
  )
  SELECT coalesce(array_agg(v.line ORDER BY v.line), '{}') FROM violation v
$$;

-- Self-check: a definer routine on search_path=public that authenticated can
-- execute, and an allow-list entry for a routine that does not exist, are
-- each reported.
CREATE FUNCTION public.f8_probe_definer() RETURNS INTEGER
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT 1 $$;
GRANT EXECUTE ON FUNCTION public.f8_probe_definer() TO authenticated;
CREATE FUNCTION public.f8_probe_invoker() RETURNS INTEGER
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT 1 $$;
GRANT EXECUTE ON FUNCTION public.f8_probe_invoker() TO authenticated;

DO $$
DECLARE
  v_found TEXT[] := pg_temp.definer_violations(ARRAY['public.f8_probe_missing(integer)']);
BEGIN
  ASSERT 'browser roles execute routine public.f8_probe_definer()' = ANY (v_found),
    format('self-check: the executable definer probe went unreported: %s', v_found);
  ASSERT 'browser roles execute routine public.f8_probe_invoker()' = ANY (v_found), 'invoker grant must be detected';
  ASSERT 'missing caller comment on public.f8_probe_definer()' = ANY (v_found), 'undocumented definer must be detected';
  ASSERT 'search_path is not "" on public.f8_probe_definer() (search_path=public)' = ANY (v_found),
    format('self-check: the probe''s search_path=public went unreported: %s', v_found);
  ASSERT 'stale allow-list entry public.f8_probe_missing(integer)' = ANY (v_found),
    format('self-check: the stale allow-list entry went unreported: %s', v_found);
END;
$$;

DROP FUNCTION public.f8_probe_definer();
DROP FUNCTION public.f8_probe_invoker();

DO $$
DECLARE
  -- The definer routines anon or authenticated may execute, each with the
  -- code that calls it.
  v_allowed CONSTANT TEXT[] := ARRAY[
    -- The friendships_select_party policy (migration 075) calls it for a
    -- signed-in learner, so authenticated needs EXECUTE. It reads only the
    -- caller's own block on one pair.
    'devshark_private.friendship_blocked_by_viewer(text,text)'
  ];
  v_found TEXT[] := pg_temp.definer_violations(v_allowed);
BEGIN
  ASSERT cardinality(v_found) = 0, format('definer invariants: %s', array_to_string(v_found, '; '));
END;
$$;
