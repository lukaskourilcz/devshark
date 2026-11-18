-- Synthetic load for supabase/bench/explain.sql: 20,000 learners with about
-- 120 days of history, so the planner shows the plans production will get
-- once it has learners (it holds about a dozen accounts today, and every
-- table there fits in one page).
--
-- Run it only on a throwaway copy of a database that `npm run test:sql` just
-- built (supabase/bench/README.md has the commands). It refuses a database
-- named postgres, the name of every Supabase project and of CI's database,
-- and a database whose user_stats or auth.users holds any row, so it can run
-- once per copy. It needs a superuser: triggers stay off while it loads.
--
-- About 1.3 GB on disk and 8 minutes on a laptop.
\set ON_ERROR_STOP on

BEGIN;

DO $guard$
BEGIN
  IF current_database() = 'postgres' THEN
    RAISE EXCEPTION 'supabase/bench/seed.sql refuses the database named postgres; seed a createdb -T copy of a test:sql database (supabase/bench/README.md)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_stats) OR EXISTS (SELECT 1 FROM auth.users) THEN
    RAISE EXCEPTION 'supabase/bench/seed.sql refuses %: public.user_stats or auth.users already has rows, so this is not a fresh test:sql copy (or it is seeded already)', current_database();
  END IF;
END;
$guard$;

-- Triggers off: the load writes the derived rows itself.
SET LOCAL session_replication_role = replica;
CREATE TEMP TABLE u ON COMMIT DROP AS
SELECT i, 'aaaaaaaa-0000-4000-8000-' || lpad(i::TEXT, 12, '0') AS id FROM generate_series(1, 20000) i;

INSERT INTO public.user_stats (user_id, name, picture, total_quizzes, total_correct, total_questions, current_streak, longest_streak, last_quiz_date, show_on_leaderboards)
SELECT id, 'Learner ' || i, 'https://lh3.googleusercontent.com/a/' || i, i % 50, i % 900, (i % 900) + 100, i % 20, i % 40, CURRENT_DATE - (i % 60), i % 3 = 0 FROM u;
INSERT INTO public.user_handles (user_id, handle, discoverable, country, leaderboard_name_mode)
SELECT id, 'shark' || i, i % 2 = 0, 'CZ', 'nickname' FROM u;

-- About 30 active days in the last 120, two of twelve categories a day: 1.2 M rows.
INSERT INTO public.user_activity_days (user_id, day, category, correct, answered)
SELECT u.id, CURRENT_DATE - d,
       (ARRAY['html','css','javascript','typescript','react','nextjs','nodejs','databases','git','general','dsa','algorithms'])[1 + (abs(hashtext(u.id)) + d * 2 + k) % 12],
       (u.i + d) % 8, 8
  FROM u, generate_series(0, 119) d, generate_series(0, 1) k
 WHERE (u.i + d) % 4 = 0;
-- The same 30 days earn XP (600,000 rows), each paid by two XP credits
-- (1.2 M rows) that the daily coin cap sums.
INSERT INTO public.user_xp_days (user_id, day, subject, xp)
SELECT u.id, CURRENT_DATE - d, 'webdev', 10 + (u.i + d) % 90
  FROM u, generate_series(0, 119) d WHERE (u.i + d) % 4 = 0;
INSERT INTO public.token_xp_credits (event_id, user_id, subject, day, xp, base, multiplier, credited, created_at)
SELECT 'xp:learn:' || u.i || ':' || d || ':' || k, u.id, 'webdev', CURRENT_DATE - d, 20, 2, 1, 2, (CURRENT_DATE - d) + INTERVAL '12 hours'
  FROM u, generate_series(0, 119) d, generate_series(1, 2) k WHERE (u.i + d) % 4 = 0;
INSERT INTO public.user_category_stats (user_id, category, total_correct, total_questions)
SELECT u.id, c, u.i % 300, 300 FROM u, unnest(ARRAY['javascript', 'css', 'html', 'react']) c;

-- Hall of Fame: 200,000 runs, a quarter from guests.
INSERT INTO public.challenge_scores (user_id, name, score, created_at, run_id, subject)
SELECT CASE WHEN g % 4 = 0 THEN NULL ELSE 'aaaaaaaa-0000-4000-8000-' || lpad((1 + g % 20000)::TEXT, 12, '0') END,
       'runner' || g, 1 + g % 5000, NOW() - (g % 365) * INTERVAL '1 day', 'run' || g, 'webdev'
  FROM generate_series(1, 200000) g;
INSERT INTO public.daily_attempts (user_id, challenge_date, correct, total, duration_ms, subject)
SELECT u.id, CURRENT_DATE - d, (u.i + d) % 6, 5, 30000 + u.i, 'webdev' FROM u, generate_series(0, 59) d WHERE (u.i + d) % 5 = 0;

-- Ten accepted friends each, plus pending requests.
INSERT INTO public.friendships (user_low, user_high, requested_by, state, created_at, responded_at)
SELECT LEAST(a.id, b.id), GREATEST(a.id, b.id), a.id, CASE WHEN k <= 10 THEN 'accepted' ELSE 'pending' END, NOW() - k * INTERVAL '1 day', NOW()
  FROM u a, generate_series(1, 12) k, LATERAL (SELECT id FROM u WHERE u.i = 1 + (a.i + k * 997) % 20000) b
 WHERE a.id <> b.id
ON CONFLICT DO NOTHING;

INSERT INTO public.coding_progress (user_id, task_id, track, status, verified, passes)
SELECT u.id, 'task-' || t, 'javascript', CASE WHEN t % 3 = 0 THEN 'in_progress' ELSE 'passed' END, TRUE, 1 FROM u, generate_series(1, 40) t;
INSERT INTO public.token_ledger (event_id, user_id, subject, amount, reason, reference, created_at)
SELECT 'evt:' || lpad(u.i::TEXT, 6, '0') || ':' || e, u.id, 'webdev', 5, 'verified-xp', 'ref:' || u.i || ':' || e, NOW() - e * INTERVAL '1 day' FROM u, generate_series(1, 10) e;
INSERT INTO public.flashcards (user_id, question_id, question, correct_answer, created_at, subject)
SELECT u.id, 'q' || q, 'Question ' || q, 'Answer', NOW() - q * INTERVAL '1 hour', 'webdev' FROM u, generate_series(1, 10) q;
INSERT INTO public.user_streak_freezes (user_id, period, remaining) SELECT id, to_char(CURRENT_DATE, 'YYYY-MM'), 2 FROM u;
INSERT INTO public.auth_events (user_id, provider, event_type, created_at)
SELECT u.id, 'google', 'login', NOW() - e * INTERVAL '14 days' FROM u, generate_series(0, 26) e WHERE u.i % 2 = 0;

-- Rows the daily purge removes: four months of submissions and attempts.
INSERT INTO public.quiz_submissions (grade_key, attempt_id, user_id, subject, answer_hash, created_at)
SELECT 'grade:' || lpad(g::TEXT, 16, '0'), 'attempt' || lpad(g::TEXT, 16, '0'), 'aaaaaaaa-0000-4000-8000-' || lpad((1 + g % 20000)::TEXT, 12, '0'), 'webdev', md5(g::TEXT) || md5(g::TEXT), NOW() - (g % 120) * INTERVAL '1 day'
  FROM generate_series(1, 150000) g;
INSERT INTO public.roadmap_attempts (attempt_id, user_id, subject, topic, kind, ref, total_questions, pass_pct, expires_at, created_at, completed_at)
SELECT 'rattempt' || lpad(g::TEXT, 16, '0'), 'aaaaaaaa-0000-4000-8000-' || lpad((1 + g % 20000)::TEXT, 12, '0'), 'webdev', 'html', 'level', 1, 10, 80, NOW() - (g % 120) * INTERVAL '1 day' + INTERVAL '3 hours', NOW() - (g % 120) * INTERVAL '1 day', CASE WHEN g % 2 = 0 THEN NOW() END
  FROM generate_series(1, 100000) g;
INSERT INTO public.coding_attempts (attempt_id, user_id, task_id, track, outcome, created_at)
SELECT 'cattempt' || g, 'aaaaaaaa-0000-4000-8000-' || lpad((1 + g % 20000)::TEXT, 12, '0'), 'task-1', 'javascript', 'passed', NOW() - (g % 240) * INTERVAL '1 day'
  FROM generate_series(1, 100000) g;
INSERT INTO public.question_reports (question_id, reason, reporter_sub, created_at, content_version)
SELECT 'q' || (g % 3000), 'wrong', 'aaaaaaaa-0000-4000-8000-' || lpad((1 + g % 20000)::TEXT, 12, '0'), NOW() - (g % 200) * INTERVAL '1 day', 'v1' FROM generate_series(1, 30000) g;

-- Admin overrides, which every server instance reads in full: 2,000
-- deletion markers (all 486 rows in production on 18 November 2026 are
-- markers) and 1,000 full rewrites with text.
INSERT INTO public.question_edits (question_id, is_custom, deleted, question, options, correct_index, explanation, introduction, category, tags, difficulty, importance)
SELECT 'q' || g, g % 10 = 0, g <= 2000,
       CASE WHEN g > 2000 THEN 'Question ' || g || ': ' || repeat('what does this snippet log, and why? ', 4) END,
       CASE WHEN g > 2000 THEN jsonb_build_array(repeat('a ', 30), repeat('b ', 30), repeat('c ', 30), repeat('d ', 30)) END,
       CASE WHEN g > 2000 THEN g % 4 END,
       CASE WHEN g > 2000 THEN repeat('The explanation names the rule and the trap it sets. ', 8) END,
       CASE WHEN g > 2000 AND g % 3 = 0 THEN repeat('A short lesson before the question. ', 8) END,
       CASE WHEN g > 2000 THEN (ARRAY['html','css','javascript','typescript','react','nextjs','nodejs','databases','git','general'])[1 + g % 10] END,
       CASE WHEN g > 2000 THEN '["scope", "closures"]'::JSONB END,
       CASE WHEN g > 2000 THEN 1 + g % 3 END,
       CASE WHEN g > 2000 THEN 1 + g % 10 END
  FROM generate_series(1, 3000) g;

COMMIT;
VACUUM ANALYZE;
