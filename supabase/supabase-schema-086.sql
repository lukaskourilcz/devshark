-- Migration 086: schedule the established daily purge at 03:07 in the pg_cron time zone.
-- Apply after 085. The retention windows are defined in the purge routine.
-- Rollback for a newly scheduled environment: unschedule this exact named job.
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';

DO $schedule$
DECLARE
  job_name CONSTANT TEXT := 'purge_expired_learning_data_daily';
  cmd CONSTANT TEXT := 'SELECT public.purge_expired_learning_data();';
BEGIN
  IF to_regprocedure('public.purge_expired_learning_data(timestamptz)') IS NULL THEN
    RAISE EXCEPTION '086 requires public.purge_expired_learning_data()';
  END IF;
  IF to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
    RAISE NOTICE 'pg_cron is unavailable. Enable it and reapply 086 to schedule the retention job.';
    RETURN;
  END IF;
  IF EXISTS (SELECT FROM cron.job WHERE jobname = job_name AND (username <> current_user OR database <> current_database())) THEN
    RAISE EXCEPTION '086 found a purge job owned by another role or targeting a different database';
  END IF;
  IF EXISTS (SELECT FROM cron.job WHERE jobname = job_name AND NOT active) THEN
    RAISE EXCEPTION 'the existing purge job is disabled; review its owner setting before applying 086';
  END IF;
  IF NOT EXISTS (SELECT FROM cron.job WHERE jobname = job_name AND username = current_user
                  AND database = current_database() AND active AND schedule = '7 3 * * *' AND btrim(command) = cmd) THEN
    PERFORM cron.schedule(job_name, '7 3 * * *', cmd);
  END IF;
END;
$schedule$;
COMMIT;
