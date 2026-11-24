DO $$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'retention schedule not available on this PostgreSQL build (no pg_cron)';
    RETURN;
  END IF;
  ASSERT (SELECT count(*) = 1 FROM cron.job WHERE jobname = 'purge_expired_learning_data_daily'),
    'exactly one named retention job must exist';
  ASSERT EXISTS (SELECT FROM cron.job WHERE jobname = 'purge_expired_learning_data_daily'
      AND schedule = '7 3 * * *' AND active AND database = current_database()
      AND username = current_user AND btrim(command) = 'SELECT public.purge_expired_learning_data();'),
    'the active retention job must call the audited routine on the local database at 03:07 scheduler time';
END;
$$;
