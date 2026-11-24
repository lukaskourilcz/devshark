-- Browser clients read only explicitly granted tables. Play uses named Broadcast
-- channels, independent of the publication that streams raw table changes.
-- Rollback: restore the previous schema-specific role defaults and sequence
-- grants from the pre-migration ACL inventory, and add back only tables that
-- belonged to supabase_realtime before this migration.
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';

REVOKE ALL ON SEQUENCE public.learning_path_evidence_evidence_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.learning_path_evidence_evidence_id_seq TO service_role;

DO $grants$
DECLARE
  creator NAME;
  room_table NAME;
BEGIN
  FOR creator IN
    SELECT rolname FROM pg_catalog.pg_roles
    WHERE rolname = current_user OR (rolname = 'postgres' AND pg_has_role(current_user, oid, 'MEMBER'))
  LOOP
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated', creator);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated', creator);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated', creator);
  END LOOP;

  FOR room_table IN
    SELECT tablename FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
      AND tablename IN ('matches', 'match_participants', 'match_answers')
  LOOP
    EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', room_table);
  END LOOP;
END;
$grants$;

COMMIT;
