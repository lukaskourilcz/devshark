-- Migration 088: retire the unverified guest XP writer (021). Apply after 087.
-- No production handler uses it. Existing account balances and award ledgers stay intact.
-- To reverse, restore the definition and service-role-only grants from 021.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $guard$
DECLARE
  calls CONSTANT TEXT := '\mmerge_user_xp\M[[:space:]]*\(';
BEGIN
  IF to_regprocedure('public.merge_user_xp(text,bigint,jsonb)') IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_proc p
              WHERE p.oid <> 'public.merge_user_xp(text,bigint,jsonb)'::regprocedure
                AND p.prosrc ~* calls) THEN
    RAISE EXCEPTION '088 found a stored caller of merge_user_xp';
  END IF;
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF EXISTS (SELECT FROM cron.job WHERE command ~* calls) THEN
      RAISE EXCEPTION '088 found a scheduled caller of merge_user_xp';
    END IF;
  END IF;
END;
$guard$;
DROP FUNCTION IF EXISTS public.merge_user_xp(TEXT, BIGINT, JSONB) RESTRICT;
COMMIT;
