-- Disposable database fixtures for Supabase roles and auth. On the CI image
-- also enable the available pg_cron extension so its real catalog is tested.
-- A bare PostgreSQL install can run the rest of the suite without pg_cron.
CREATE SCHEMA IF NOT EXISTS extensions;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
    -- What Supabase grants on everything created in public: the browser
    -- roles too, which is why every table needs RLS and every service
    -- routine its REVOKE.
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
  END IF;
END;
$$;

-- Roles belong to the cluster; default grants belong to each database. A
-- second disposable database needs the same defaults even with existing roles.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

DO $$
BEGIN
  IF to_regnamespace('auth') IS NULL THEN
    CREATE SCHEMA auth;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
  END IF;
  -- Migration 044 reads auth.users; the suite only needs its id column.
  IF to_regclass('auth.users') IS NULL THEN
    CREATE TABLE auth.users (id UUID PRIMARY KEY);
  END IF;
  -- auth.uid() as Supabase defines it: the `sub` claim of the request's JWT.
  IF to_regprocedure('auth.uid()') IS NULL THEN
    CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $body$
      SELECT COALESCE(
        NULLIF(current_setting('request.jwt.claim.sub', TRUE), ''),
        (NULLIF(current_setting('request.jwt.claims', TRUE), '')::JSONB ->> 'sub')
      )::UUID
    $body$;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    IF current_setting('cron.database_name', true) IS DISTINCT FROM current_database() THEN
      RAISE NOTICE 'pg_cron is not preloaded for this database; retention schedule will be skipped';
    ELSE
      CREATE EXTENSION IF NOT EXISTS pg_cron;
    END IF;
  END IF;
END;
$$;

-- Local bare PostgreSQL also needs the provider's policy-facing contract.
\ir realtime-fixture.sql
