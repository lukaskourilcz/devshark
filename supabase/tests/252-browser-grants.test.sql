-- What the browser roles hold outside tables and routines. The anon key ships
-- in the client, so anything anon or authenticated holds is public:
--
-- 1. No sequence in public: USAGE or UPDATE lets a caller burn or reset ids,
--    SELECT reads how many rows a table has had.
-- 2. No default privilege of the migration role (current_user) in public
--    that grants them anything. Every table, sequence and routine a future
--    migration creates would otherwise start out granted to the browser.
-- 3. No CREATE on schema public.
-- 4. No public table in a publication: Realtime would stream its changes to
--    subscribers. 075 already refuses to run with friendships in one; CI's
--    publications hold no table, so there this passes by construction, and it
--    reads production's once the migrations are applied there.

CREATE FUNCTION pg_temp.grant_violations()
RETURNS TEXT[] LANGUAGE sql STABLE AS $$
  WITH browser(role) AS (VALUES ('anon'), ('authenticated')),
  violation(line) AS (
    SELECT b.role || ' holds ' || string_agg(k.priv, ', ' ORDER BY k.priv) || ' on sequence ' || c.relname
      FROM pg_catalog.pg_class c
     CROSS JOIN browser b
     CROSS JOIN (VALUES ('SELECT'), ('UPDATE'), ('USAGE')) AS k(priv)
     WHERE c.relnamespace = 'public'::REGNAMESPACE AND c.relkind = 'S'
       AND pg_catalog.has_sequence_privilege(b.role, c.oid, k.priv)
     GROUP BY b.role, c.relname
    UNION ALL
    SELECT format('default privileges of %s in public give %s %s on new %s',
                  pg_catalog.pg_get_userbyid(d.defaclrole), pg_catalog.pg_get_userbyid(a.grantee),
                  string_agg(a.privilege_type, ', ' ORDER BY a.privilege_type),
                  CASE d.defaclobjtype WHEN 'r' THEN 'tables' WHEN 'S' THEN 'sequences' WHEN 'f' THEN 'routines'
                                       WHEN 'T' THEN 'types' WHEN 'n' THEN 'schemas' ELSE d.defaclobjtype::TEXT END)
      FROM pg_catalog.pg_default_acl d
     CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) AS a
     WHERE d.defaclrole = current_user::REGROLE
       AND d.defaclnamespace = 'public'::REGNAMESPACE
       AND a.grantee IN (SELECT b.role::REGROLE FROM browser b)
     GROUP BY d.defaclrole, a.grantee, d.defaclobjtype
    UNION ALL
    SELECT b.role || ' holds CREATE on schema public'
      FROM browser b WHERE pg_catalog.has_schema_privilege(b.role, 'public', 'CREATE')
    UNION ALL
    SELECT 'publication ' || t.pubname || ' streams public.' || t.tablename
      FROM pg_catalog.pg_publication_tables t WHERE t.schemaname = 'public'
  )
  SELECT coalesce(array_agg(v.line ORDER BY v.line), '{}') FROM violation v
$$;

-- Self-check: one probe of each kind, made in a subtransaction that is rolled
-- back, so the real check below sees the catalog as the migrations left it.
DO $$
DECLARE
  v_found TEXT[];
  v_line TEXT;
BEGIN
  BEGIN
    CREATE TABLE public.f8_probe_published (id INTEGER PRIMARY KEY);
    CREATE SEQUENCE public.f8_probe_seq;
    REVOKE ALL ON SEQUENCE public.f8_probe_seq FROM PUBLIC, anon, authenticated;
    GRANT USAGE ON SEQUENCE public.f8_probe_seq TO anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT TRIGGER ON TABLES TO authenticated;
    GRANT CREATE ON SCHEMA public TO anon;
    -- A Postgres below wal_level=logical warns on CREATE PUBLICATION.
    PERFORM pg_catalog.set_config('client_min_messages', 'error', TRUE);
    CREATE PUBLICATION f8_probe_publication FOR TABLE public.f8_probe_published;
    v_found := pg_temp.grant_violations();
    RAISE EXCEPTION 'f8 probe rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'f8 probe rollback' THEN RAISE; END IF;
  END;
  FOREACH v_line IN ARRAY ARRAY[
    'anon holds USAGE on sequence f8_probe_seq',
    'anon holds CREATE on schema public',
    'publication f8_probe_publication streams public.f8_probe_published'
  ] LOOP
    ASSERT v_line = ANY (v_found), format('self-check: "%s" went unreported: %s', v_line, v_found);
  END LOOP;
  ASSERT EXISTS (
    SELECT 1 FROM unnest(v_found) AS f(line)
     WHERE f.line LIKE 'default privileges of ' || current_user || ' in public give authenticated %TRIGGER% on new tables'
  ), format('self-check: the default TRIGGER grant on new tables went unreported: %s', v_found);
END;
$$;

DO $$
DECLARE
  v_found TEXT[] := pg_temp.grant_violations();
BEGIN
  ASSERT cardinality(v_found) = 0, format('grant invariants: %s', array_to_string(v_found, '; '));
END;
$$;
