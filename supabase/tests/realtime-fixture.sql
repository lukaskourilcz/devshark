-- A database-only image does not run the Realtime service's tenant migrations.
-- Supply its policy-facing contract on the disposable database when absent.
DO $fixture$
BEGIN
  IF to_regnamespace('realtime') IS NULL THEN CREATE SCHEMA realtime; END IF;
  IF to_regclass('realtime.messages') IS NULL THEN
    CREATE TABLE realtime.messages (topic TEXT NOT NULL, extension TEXT NOT NULL);
    ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
    -- The Supabase image reserves schema creation to its bootstrap account.
    -- The normal application migration role must own only this synthetic table
    -- so that CREATE POLICY runs under its usual credentials in CI.
    IF current_user = 'supabase_admin' THEN ALTER TABLE realtime.messages OWNER TO postgres; END IF;
    GRANT USAGE ON SCHEMA realtime TO anon, authenticated;
    GRANT SELECT, INSERT ON realtime.messages TO anon, authenticated;
  END IF;
  IF to_regprocedure('realtime.topic()') IS NULL THEN
    CREATE FUNCTION realtime.topic() RETURNS TEXT LANGUAGE sql STABLE AS $topic$
      SELECT nullif(current_setting('realtime.topic', true), '')
    $topic$;
    GRANT EXECUTE ON FUNCTION realtime.topic() TO authenticated;
  END IF;
END;
$fixture$;
