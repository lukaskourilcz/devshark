-- The row level security invariants for every table in public, read from the
-- catalog. 010-schema-security.test.sql checks that RLS is on and
-- 158-rls-own-rows-only.test.sql that each browser policy reads the caller's
-- own rows; neither fails on the shapes below.
--
-- 1. RLS is on.
-- 2. An INSERT, UPDATE or ALL policy has a WITH CHECK.
-- 3. Each auth.uid(), auth.jwt(), auth.role(), auth.email() or
--    current_setting( call in a policy sits right after SELECT, so Postgres
--    runs it once per statement as an init plan instead of once per row.
--    Counting every call is stricter than Supabase's auth_rls_initplan lint,
--    which passes a policy with one wrapped and one bare call.
-- 4. A SELECT, INSERT, UPDATE or DELETE privilege of anon or authenticated has
--    a policy of that command (or ALL) for that role.
-- 5. anon and authenticated hold no TRUNCATE, REFERENCES or TRIGGER: RLS
--    does not filter TRUNCATE.
-- 6. A table with policies grants anon or authenticated something to use
--    them with; a policy on a service-role-only table is dead code.
-- 7. No policy applies to public or anon. A browser read is a signed-in
--    learner reading their own rows, so its policy names authenticated.

CREATE FUNCTION pg_temp.rls_violations()
RETURNS TEXT[] LANGUAGE sql STABLE AS $$
  WITH tbl AS (
    SELECT c.oid, c.relname::TEXT AS name, c.relrowsecurity
      FROM pg_catalog.pg_class c
     WHERE c.relnamespace = 'public'::REGNAMESPACE AND c.relkind IN ('r', 'p')
  ),
  pol AS (
    SELECT p.tablename::TEXT AS tbl, p.tablename || '.' || p.policyname AS name, p.cmd, p.roles::TEXT[] AS roles,
           p.with_check IS NOT NULL AS has_check,
           lower(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) AS expr
      FROM pg_catalog.pg_policies p
     WHERE p.schemaname = 'public'
  ),
  privilege AS (
    SELECT t.name AS tbl, r.role, k.cmd
      FROM tbl t
     CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role)
     CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS k(cmd)
     WHERE pg_catalog.has_table_privilege(r.role, t.oid, k.cmd)
  ),
  violation(line) AS (
    SELECT 'RLS off on ' || t.name FROM tbl t WHERE NOT t.relrowsecurity
    UNION ALL
    SELECT p.cmd || ' policy without WITH CHECK ' || p.name
      FROM pol p WHERE p.cmd IN ('INSERT', 'UPDATE', 'ALL') AND NOT p.has_check
    UNION ALL
    SELECT f.call || ' outside a subselect in ' || p.name
      FROM pol p
     CROSS JOIN unnest(ARRAY['auth.uid()', 'auth.jwt()', 'auth.role()', 'auth.email()', 'current_setting(']) AS f(call)
     WHERE length(p.expr) - length(replace(p.expr, f.call, '')) > 0
       AND (length(p.expr) - length(replace(p.expr, f.call, ''))) / length(f.call)
         > (length(p.expr) - length(replace(p.expr, 'select ' || f.call, ''))) / length('select ' || f.call)
    UNION ALL
    SELECT v.role || ' holds ' || v.cmd || ' on ' || v.tbl || ' with no ' || v.cmd || ' policy for it'
      FROM privilege v
     WHERE v.cmd IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
       AND NOT EXISTS (
         SELECT 1 FROM pol p
          WHERE p.tbl = v.tbl AND p.cmd IN (v.cmd, 'ALL') AND p.roles && ARRAY[v.role, 'public']
       )
    UNION ALL
    SELECT v.role || ' holds ' || v.cmd || ' on ' || v.tbl
      FROM privilege v WHERE v.cmd IN ('TRUNCATE', 'REFERENCES', 'TRIGGER')
    UNION ALL
    SELECT 'dead policy ' || p.name || ': anon and authenticated hold no privilege on ' || p.tbl
      FROM pol p
     WHERE NOT EXISTS (SELECT 1 FROM privilege v WHERE v.tbl = p.tbl AND v.cmd IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE'))
    UNION ALL
    SELECT 'policy for ' || r.role || ' ' || p.name
      FROM pol p CROSS JOIN unnest(p.roles) AS r(role) WHERE r.role IN ('public', 'anon')
  )
  SELECT coalesce(array_agg(v.line ORDER BY v.line), '{}') FROM violation v
$$;

-- Self-check: probe tables with one of each shape, each reported.
CREATE TABLE public.f8_probe_rls_off (user_id TEXT);
ALTER TABLE public.f8_probe_rls_off DISABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.f8_probe_rls_off FROM PUBLIC, anon, authenticated;
GRANT TRUNCATE ON public.f8_probe_rls_off TO anon;

CREATE TABLE public.f8_probe_policy (user_id TEXT);
ALTER TABLE public.f8_probe_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.f8_probe_policy FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON public.f8_probe_policy TO authenticated;
CREATE POLICY f8_probe_update ON public.f8_probe_policy FOR UPDATE TO authenticated
  USING (user_id = auth.uid()::TEXT);
CREATE POLICY f8_probe_mixed ON public.f8_probe_policy FOR SELECT
  USING (user_id = (SELECT auth.uid())::TEXT OR user_id = auth.uid()::TEXT);

CREATE TABLE public.f8_probe_dead (user_id TEXT);
ALTER TABLE public.f8_probe_dead ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.f8_probe_dead FROM PUBLIC, anon, authenticated;
CREATE POLICY f8_probe_dead_select ON public.f8_probe_dead FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid())::TEXT);

DO $$
DECLARE
  v_found TEXT[] := pg_temp.rls_violations();
  v_line TEXT;
BEGIN
  FOREACH v_line IN ARRAY ARRAY[
    'RLS off on f8_probe_rls_off',
    'anon holds TRUNCATE on f8_probe_rls_off',
    'UPDATE policy without WITH CHECK f8_probe_policy.f8_probe_update',
    'auth.uid() outside a subselect in f8_probe_policy.f8_probe_update',
    'auth.uid() outside a subselect in f8_probe_policy.f8_probe_mixed',
    'policy for public f8_probe_policy.f8_probe_mixed',
    'authenticated holds DELETE on f8_probe_policy with no DELETE policy for it',
    'dead policy f8_probe_dead.f8_probe_dead_select: anon and authenticated hold no privilege on f8_probe_dead'
  ] LOOP
    ASSERT v_line = ANY (v_found), format('self-check: "%s" went unreported: %s', v_line, v_found);
  END LOOP;
  ASSERT NOT ('auth.uid() outside a subselect in f8_probe_dead.f8_probe_dead_select' = ANY (v_found)),
    'self-check: a policy whose only auth.uid() call sits in a subselect was reported';
END;
$$;

DROP TABLE public.f8_probe_rls_off, public.f8_probe_policy, public.f8_probe_dead;

DO $$
DECLARE
  v_found TEXT[] := pg_temp.rls_violations();
BEGIN
  ASSERT cardinality(v_found) = 0, format('RLS invariants: %s', array_to_string(v_found, '; '));
END;
$$;
