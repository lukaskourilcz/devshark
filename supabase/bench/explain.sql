-- EXPLAIN (ANALYZE, BUFFERS) for 17 reads that the leaderboards, friends,
-- coding progress, coins, Shark Cards, the question overrides and the XP
-- coin cap make, on a database that supabase/bench/seed.sql loaded. It prints
-- one plan per read under a "### NN" heading and changes nothing: everything
-- runs in a read-only transaction that rolls back.
--
-- The leaderboard and friend reads are SQL SECURITY DEFINER routines. Postgres
-- never inlines those, so EXPLAIN of a call shows only a Function Scan. This
-- script reads each routine's current body from the catalog and prepares it
-- with its parameters, and runs it as a generic plan, because Postgres 17
-- plans the statement of an SQL routine without the argument values. The
-- other reads are the statements PostgREST and the plpgsql routines send,
-- with the arguments written in.
--
--   psql -X -d <seeded database> -f supabase/bench/explain.sql
\set ON_ERROR_STOP on
\pset pager off
\set learner '''aaaaaaaa-0000-4000-8000-000000000040'''
\set categories 'ARRAY[''html'',''css'',''javascript'',''typescript'',''react'',''nextjs'',''nodejs'',''databases'',''git'',''general'']'

BEGIN READ ONLY;

DO $guard$
BEGIN
  IF current_database() = 'postgres'
     OR NOT EXISTS (SELECT 1 FROM public.user_stats WHERE user_id = 'aaaaaaaa-0000-4000-8000-000000000040') THEN
    RAISE EXCEPTION 'supabase/bench/explain.sql needs a database loaded by supabase/bench/seed.sql (supabase/bench/README.md)';
  END IF;
END;
$guard$;

-- One prepared statement per routine: its body with $1, $2, … for its
-- arguments, in their declared types.
DO $prepare$
DECLARE
  one RECORD;
  v_names TEXT[];
  v_types TEXT;
  v_body TEXT;
BEGIN
  FOR one IN SELECT * FROM (VALUES
    ('window_board', 'public.window_leaderboard(integer,integer,text,integer,text)'),
    ('window_rank', 'public.window_leaderboard_rank(text,integer,text,integer)'),
    ('month_ranks', 'public.month_xp_ranks(text,date)'),
    ('month_board', 'public.month_xp_leaderboard(text,integer,text,text)'),
    ('month_rank', 'public.month_xp_leaderboard_rank(text,text,text)'),
    ('category_board', 'public.category_leaderboard(text,integer,integer)'),
    ('subject_board', 'public.subject_leaderboard(text[],integer)'),
    ('daily_board', 'public.daily_leaderboard_v2(date,text,integer)'),
    ('challenge_board', 'public.challenge_leaderboard(text,integer)'),
    ('friends', 'public.friend_list(text,text[])')
  ) AS routine(statement, signature) LOOP
    SELECT array_agg(a.name ORDER BY a.position),
           (SELECT string_agg(format_type(t.type, NULL), ', ' ORDER BY t.position)
              FROM unnest(p.proargtypes::OID[]) WITH ORDINALITY AS t(type, position)),
           regexp_replace(p.prosrc, ';\s*$', '')
      INTO v_names, v_types, v_body
      FROM pg_proc p,
           unnest(p.proargnames, coalesce(p.proargmodes, array_fill('i'::"char", ARRAY[cardinality(p.proargnames)])))
             WITH ORDINALITY AS a(name, mode, position)
     WHERE p.oid = one.signature::regprocedure AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'sql')
       AND a.mode IN ('i', 'b', 'v')
     GROUP BY p.oid, p.proargtypes, p.prosrc;
    IF v_body IS NULL OR position(';' IN v_body) > 0 THEN
      RAISE EXCEPTION 'supabase/bench/explain.sql expects % to be a one-statement SQL routine', one.signature;
    END IF;
    FOR i IN 1 .. cardinality(v_names) LOOP
      v_body := regexp_replace(v_body, '\m' || v_names[i] || '\M', '$' || i, 'g');
    END LOOP;
    EXECUTE format('PREPARE %I(%s) AS %s', one.statement, v_types, v_body);
  END LOOP;
END;
$prepare$;

SET LOCAL plan_cache_mode = force_generic_plan;

\echo '### 01 window_leaderboard: the 30-day board, every category (api/leaderboard.ts)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, SUMMARY ON) EXECUTE window_board(30, 100, NULL, 5, :learner);
\echo '### 02 window_leaderboard_rank: the viewer''s place on the 30-day board'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, SUMMARY ON) EXECUTE window_rank(:learner, 30, NULL, 5);
\echo '### 03 month_xp_ranks: the month''s XP per learner, read by 04 and 05'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, SUMMARY ON) EXECUTE month_ranks('webdev', date_trunc('month', NOW() AT TIME ZONE 'UTC')::DATE);
\echo '### 04 month_xp_leaderboard: the month XP board'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, SUMMARY ON) EXECUTE month_board('webdev', 100, :learner, to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM'));
\echo '### 05 month_xp_leaderboard_rank: the viewer''s own month XP and place (user_xp_days)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, SUMMARY ON) EXECUTE month_rank(:learner, 'webdev', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM'));
\echo '### 06 category_leaderboard: javascript, all time'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, SUMMARY ON) EXECUTE category_board('javascript', 50, 5);
\echo '### 07 subject_leaderboard: every devShark category, all time'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, SUMMARY ON) EXECUTE subject_board(:categories, 100);
\echo '### 08 daily_leaderboard_v2: today''s daily question'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, SUMMARY ON) EXECUTE daily_board((NOW() AT TIME ZONE 'UTC')::DATE, 'webdev', 50);
\echo '### 09 challenge_leaderboard: the Hall of Fame top ten'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, SUMMARY ON) EXECUTE challenge_board('webdev', 10);
\echo '### 10 friend_list: the viewer''s friends with their stats (lib/friends-handlers.ts)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, SUMMARY ON) EXECUTE friends(:learner, :categories);

SET LOCAL plan_cache_mode = auto;

\echo '### 11 allocate_shark_name: the Hall of Fame name check, under the global counter lock (063)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, SUMMARY ON)
SELECT 1 FROM public.challenge_scores c WHERE lower(c.name) = lower('reefRunner20001')
   AND NOT (COALESCE(c.user_id = :learner AND :learner IS NOT NULL, FALSE)
     OR COALESCE(c.run_id = substr('user:' || :learner, 7) AND :learner IS NULL, FALSE));
\echo '### 12 coding progress: the viewer''s passed tasks (lib/coding/handlers.ts)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, SUMMARY ON)
SELECT task_id, status FROM public.coding_progress WHERE user_id = :learner AND status = 'passed';
\echo '### 13 coin ledger: the last 25 entries (lib/rewards/handlers.ts)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, SUMMARY ON)
SELECT event_id, amount, reason, reference, created_at FROM public.token_ledger
 WHERE user_id = :learner AND subject = 'webdev' ORDER BY created_at DESC LIMIT 25;
\echo '### 14 Shark Cards: the viewer''s saved questions (api/flashcards.ts)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, SUMMARY ON)
SELECT question_id, question, category, correct_answer, explanation, created_at, subject FROM public.flashcards
 WHERE user_id = :learner AND subject = 'webdev' ORDER BY created_at DESC;
\echo '### 15 user_stats: the viewer''s stats row (api/user/[op].ts)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, SUMMARY ON)
SELECT id, user_id, email, name, picture, total_quizzes, total_correct, total_questions, current_streak, longest_streak, last_quiz_date, created_at, updated_at
  FROM public.user_stats WHERE user_id = :learner;
\echo '### 16 question_edits: the override refresh every server instance makes (lib/questions-store.ts)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, SUMMARY ON)
SELECT question_id, is_custom, deleted, question, options, correct_index, explanation, introduction, category, tags, difficulty, importance
  FROM public.question_edits;
\echo '### 17 credit_verified_xp_tokens: today''s coin cap, summed under the account lock (041)'
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, SUMMARY ON)
SELECT COALESCE(SUM(credited), 0) FROM public.token_xp_credits
 WHERE user_id = :learner AND subject = 'webdev' AND day = (NOW() AT TIME ZONE 'UTC')::DATE;

ROLLBACK;
DEALLOCATE ALL;
