SELECT to_regclass('cron.job') IS NOT NULL AS has_cron \gset
\if :has_cron
DO $$
BEGIN
  ASSERT (SELECT count(*) = 1 FROM cron.job WHERE jobname = 'purge_expired_learning_data_daily'),
    'exactly one named retention job must exist';
  ASSERT EXISTS (SELECT FROM cron.job WHERE jobname = 'purge_expired_learning_data_daily'
      AND schedule = '7 3 * * *' AND active AND database = current_database()
      AND username = current_user AND btrim(command) = 'SELECT public.purge_expired_learning_data();'),
    'the active retention job must call the audited routine on the local database at 03:07 scheduler time';
END;
$$;
\else
\echo TEST-SKIP: retention schedule needs the pg_cron catalog in this database
\endif
