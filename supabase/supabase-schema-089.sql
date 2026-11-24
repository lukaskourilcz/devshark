-- Migration 089: authorize private Play broadcasts using server-created room
-- memberships. Apply after 088, before releasing the private-channel client.
-- The old client continues to poll when public channels are disabled.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $prerequisites$
BEGIN
  IF to_regprocedure('realtime.topic()') IS NULL OR NOT EXISTS (
    SELECT FROM pg_catalog.pg_class WHERE oid = to_regclass('realtime.messages') AND relrowsecurity
  ) THEN
    RAISE EXCEPTION '089 requires initialized Supabase Realtime with RLS on realtime.messages';
  END IF;
  -- A permissive policy is OR-ed with ours. Existing custom grants must be
  -- reviewed before vouching for membership in a project with other rooms.
  IF EXISTS (SELECT FROM pg_catalog.pg_policies
              WHERE schemaname = 'realtime' AND tablename = 'messages'
                AND permissive = 'PERMISSIVE' AND cmd IN ('ALL','SELECT','INSERT')
                AND policyname NOT IN ('devshark_match_read','devshark_match_send')
                AND (roles && ARRAY['public','anon','authenticated']::name[]
                     OR EXISTS (SELECT FROM pg_catalog.pg_roles r WHERE r.rolname = ANY(roles)
                                 AND (pg_has_role('anon', r.oid, 'MEMBER') OR pg_has_role('authenticated', r.oid, 'MEMBER'))))) THEN
    RAISE EXCEPTION '089 requires reviewing existing Realtime client policies before authorizing match rooms';
  END IF;
END;
$prerequisites$;

-- Both the host and other players acquire this membership through the Play API.
CREATE OR REPLACE FUNCTION devshark_private.match_broadcast_member(p_topic TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT pg_catalog.starts_with(p_topic, 'match:') AND EXISTS (
    SELECT FROM public.matches m JOIN public.match_participants p ON p.match_id = m.id
     WHERE m.code = pg_catalog.substr(p_topic, 7) AND p.user_id = (SELECT auth.uid())::text
  );
$$;
REVOKE ALL ON FUNCTION devshark_private.match_broadcast_member(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION devshark_private.match_broadcast_member(TEXT) TO authenticated;
COMMENT ON FUNCTION devshark_private.match_broadcast_member(TEXT)
  IS 'Called by the devshark_match_read and devshark_match_send Broadcast policies (authenticated).';

DROP POLICY IF EXISTS devshark_match_read ON realtime.messages;
CREATE POLICY devshark_match_read ON realtime.messages FOR SELECT TO authenticated USING (
  extension = 'broadcast' AND topic = (SELECT realtime.topic())
  AND (SELECT devshark_private.match_broadcast_member((SELECT realtime.topic())))
);
DROP POLICY IF EXISTS devshark_match_send ON realtime.messages;
CREATE POLICY devshark_match_send ON realtime.messages FOR INSERT TO authenticated WITH CHECK (
  extension = 'broadcast' AND topic = (SELECT realtime.topic())
  AND (SELECT devshark_private.match_broadcast_member((SELECT realtime.topic())))
);
COMMIT;
