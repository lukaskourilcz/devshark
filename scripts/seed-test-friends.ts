/**
 * Ten test friends, as SQL.
 *
 *   npm run seed:test-friends -- --owner <user_id> > /tmp/seed.sql
 *
 * Why a generator and not a fixture: the ten accounts have to be *different
 * distances along*, and stating a streak, an XP total, an answered count and a
 * per-topic level map by hand for ten people is where fixtures start quietly
 * contradicting themselves — an 88% accuracy with four correct answers, a level
 * 6 in a topic with no answers in it. Here the profile is the input and every
 * derived row is computed from it, so the numbers agree by construction.
 *
 * Deterministic on purpose. No clock, no randomness, no network: the same
 * command produces byte-identical SQL, so re-running it is a diff you can read
 * rather than a fresh set of strangers. Dates are the one thing that must move,
 * and they are anchored to the database's own CURRENT_DATE inside the SQL
 * rather than to this process's clock, so a seed applied next month still has a
 * friend who studied "today".
 *
 * These are not real people and nothing pretends they are. The ids all begin
 * `seed-friend-`, which is what makes them findable and removable in one
 * statement — the file ends with that statement, commented out.
 *
 * Scope: writing these rows puts ten accounts into whatever database the SQL is
 * applied to, including the public leaderboard, which the owner asked for. They
 * hold no email, no name and no auth user; they exist only as progress rows and
 * a handle.
 */

/* ── the ten, as profiles ──────────────────────────────────────────────── */

interface Profile {
  /** The account id is `seed-friend-<slug>`. The slug was the first handle,
   * and stays the id so a re-run updates the same ten accounts. */
  slug: string;
  /** Original base, converted to camelCase before allocation. Existing
   * identities keep their allocated name and global number on every rerun. */
  handle: string;
  /** ISO 3166-1 alpha-2. Shown as a flag, ranked nowhere. */
  country: string;
  /** Two initials for the generated avatar. */
  initials: string;
  /** Avatar background, from the Deep End ocean range — muted, never neon. */
  ink: string;
  currentStreak: number;
  longestStreak: number;
  /** Days since their last answer. 0 puts them "active today". */
  lastSeenDaysAgo: number;
  questions: number;
  accuracyPct: number;
  questXp: number;
  /** Levels passed per topic — how far along the roadmap they actually are. */
  levels: Record<string, number>;
  crown: boolean;
}

/** Ordered from barely started to furthest along, so the spread is visible in
 * the file itself rather than only in the database. */
const PROFILES: readonly Profile[] = [
  {
    slug: 'pablo-r', handle: 'kale-no-bueno-tiburon', country: 'AR', initials: 'KN', ink: '#4a5a6a',
    currentStreak: 0, longestStreak: 1, lastSeenDaysAgo: 6,
    questions: 20, accuracyPct: 55, questXp: 60,
    levels: { html: 1 }, crown: false,
  },
  {
    slug: 'mia-dev', handle: 'fin-de-siesta', country: 'CZ', initials: 'FD', ink: '#3f6b7a',
    currentStreak: 0, longestStreak: 2, lastSeenDaysAgo: 3,
    questions: 40, accuracyPct: 62, questXp: 120,
    levels: { html: 2, css: 1 }, crown: false,
  },
  {
    slug: 'tomas-h', handle: 'stealthy-cat-shark', country: 'SK', initials: 'SC', ink: '#5a6b4a',
    currentStreak: 3, longestStreak: 5, lastSeenDaysAgo: 0,
    questions: 150, accuracyPct: 71, questXp: 480,
    levels: { html: 3, css: 2, javascript: 1 }, crown: false,
  },
  {
    slug: 'ravi-p', handle: 'deployed-lantern-shark', country: 'IN', initials: 'DL', ink: '#6b5a3f',
    currentStreak: 1, longestStreak: 9, lastSeenDaysAgo: 0,
    questions: 300, accuracyPct: 69, questXp: 900,
    levels: { html: 4, css: 3, javascript: 2, git: 1 }, crown: false,
  },
  {
    slug: 'jonas-b', handle: 'sharky-mc-burritoface', country: 'SE', initials: 'SM', ink: '#40607a',
    currentStreak: 7, longestStreak: 11, lastSeenDaysAgo: 0,
    questions: 360, accuracyPct: 74, questXp: 1100,
    levels: { html: 5, css: 4, javascript: 3, git: 2 }, crown: false,
  },
  {
    slug: 'lena-k', handle: 'muy-thirsty-sharkie', country: 'DE', initials: 'MT', ink: '#6a4a5a',
    currentStreak: 12, longestStreak: 14, lastSeenDaysAgo: 0,
    questions: 420, accuracyPct: 78, questXp: 1450,
    levels: { html: 5, css: 5, javascript: 4, git: 3, react: 1 }, crown: true,
  },
  {
    slug: 'nina-v', handle: 'mucho-drama-fin', country: 'NL', initials: 'MD', ink: '#3f6a5f',
    currentStreak: 9, longestStreak: 9, lastSeenDaysAgo: 0,
    questions: 520, accuracyPct: 76, questXp: 1900,
    levels: { html: 6, css: 5, javascript: 5, git: 3, react: 2 }, crown: true,
  },
  {
    slug: 'yuki-t', handle: 'mucho-nap-chomper', country: 'JP', initials: 'MN', ink: '#54506b',
    currentStreak: 2, longestStreak: 30, lastSeenDaysAgo: 0,
    questions: 850, accuracyPct: 81, questXp: 3100,
    levels: { html: 6, css: 6, javascript: 6, git: 4, react: 4, nodejs: 2 }, crown: false,
  },
  {
    slug: 'sofia-m', handle: 'gracias-sharkie', country: 'ES', initials: 'GS', ink: '#7a5540',
    currentStreak: 21, longestStreak: 21, lastSeenDaysAgo: 0,
    questions: 700, accuracyPct: 84, questXp: 2600,
    levels: { html: 6, css: 6, javascript: 6, git: 5, react: 3, nodejs: 1 }, crown: true,
  },
  {
    slug: 'amara-o', handle: 'el-tiburon-tremendo', country: 'NG', initials: 'ET', ink: '#2f5a63',
    currentStreak: 45, longestStreak: 45, lastSeenDaysAgo: 0,
    questions: 1400, accuracyPct: 88, questXp: 5200,
    levels: { html: 6, css: 6, javascript: 6, git: 6, react: 6, nodejs: 5, typescript: 3 }, crown: true,
  },
];

const ID_PREFIX = 'seed-friend-';
const SUBJECT = 'webdev';

/* ── derived rows ──────────────────────────────────────────────────────── */

/** The categories a profile's answers are spread over, in a fixed order. */
const SPREAD: readonly string[] = ['javascript', 'html', 'css', 'react', 'git', 'nodejs', 'typescript'];

/**
 * Split an answered total across categories so the parts sum to the whole.
 *
 * Largest share first and the remainder handed to the first category, because
 * a rounding loss here would make a friend's accuracy on the row disagree with
 * the accuracy their category rows add up to.
 */
function splitAnswers(profile: Profile): { category: string; questions: number; correct: number }[] {
  const categories = SPREAD.filter((category) => category in profile.levels || SPREAD.indexOf(category) < 2);
  const weights = categories.map((_, index) => categories.length - index);
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);

  let assigned = 0;
  const rows = categories.map((category, index) => {
    const share = index === categories.length - 1
      ? profile.questions - assigned
      : Math.floor((profile.questions * weights[index]) / weightTotal);
    assigned += share;
    return { category, questions: share, correct: Math.round((share * profile.accuracyPct) / 100) };
  });

  // The stated accuracy is the one that must hold for the whole account, so any
  // rounding drift across the categories is settled on the largest of them.
  const correctTarget = Math.round((profile.questions * profile.accuracyPct) / 100);
  const drift = correctTarget - rows.reduce((sum, row) => sum + row.correct, 0);
  rows[0].correct = Math.min(rows[0].questions, Math.max(0, rows[0].correct + drift));
  return rows.filter((row) => row.questions > 0);
}

/**
 * A deterministic avatar, built in SQL from an ink colour and two initials.
 *
 * A data URI rather than a link to an avatar service: it needs no network at
 * render time, cannot rot into a broken image, and tells no third party which
 * of the owner's friends were just looked at. The site's CSP already allows
 * `data:` for images, so nothing has to be widened to show them.
 *
 * Built here rather than pre-rendered into ten base64 blobs so the SVG is
 * readable in the generated file — a reviewer can see what the avatar is
 * instead of a 600-character string per row.
 *
 * `encode(..., 'base64')` wraps its output every 76 characters, and a newline
 * inside a data URI truncates the image, so the wrapping is stripped.
 */
const AVATAR_SQL = `'data:image/svg+xml;base64,' || replace(encode(convert_to(
         '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96" role="img">'
      || '<rect width="96" height="96" rx="48" fill="' || s.ink || '"/>'
      || '<text x="48" y="49" fill="#f4f1ea" font-family="Georgia,serif" font-size="34"'
      || ' text-anchor="middle" dominant-baseline="central" letter-spacing="1">' || s.initials || '</text>'
      || '</svg>', 'UTF8'), 'base64'), E'\\n', '')`;

/** Levels to the progress blob the roadmap already reads (shared/progression). */
function progressBlob(profile: Profile): string {
  const data: Record<string, { levels: Record<string, { passed: boolean; bestPct: number }> }> = {};
  for (const [topic, passed] of Object.entries(profile.levels)) {
    const levels: Record<string, { passed: boolean; bestPct: number }> = {};
    for (let level = 1; level <= passed; level++) {
      // A real record is uneven: the pass percentage drifts around the
      // account's accuracy rather than sitting on it, and it is bounded so a
      // "passed" level never reads as below the pass mark.
      levels[String(level)] = { passed: true, bestPct: Math.min(100, Math.max(70, profile.accuracyPct + ((level * 7) % 11) - 5)) };
    }
    data[topic] = { levels };
  }
  return JSON.stringify(data);
}

const quote = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/* ── the SQL ───────────────────────────────────────────────────────────── */

function seedSql(owner: string): string {
  const profiles: string[] = [];
  const categories: string[] = [];

  for (const profile of PROFILES) {
    const id = `${ID_PREFIX}${profile.slug}`;
    const rows = splitAnswers(profile);
    const correct = rows.reduce((sum, row) => sum + row.correct, 0);
    const questions = rows.reduce((sum, row) => sum + row.questions, 0);
    const low = id < owner ? id : owner;
    const high = id < owner ? owner : id;

    profiles.push(
      `  (${quote(id)}, ${quote(profile.handle)}, ${quote(profile.country)}, ${quote(profile.ink)}, ${quote(profile.initials)},`
      + ` ${correct}, ${questions}, ${profile.currentStreak}, ${profile.longestStreak}, ${profile.lastSeenDaysAgo},`
      + ` ${profile.questXp}, ${quote(progressBlob(profile))}::jsonb, ${profile.crown},`
      + ` ${quote(low)}, ${quote(high)})`,
    );
    for (const row of rows) {
      categories.push(`  (${quote(id)}, ${quote(row.category)}, ${row.correct}, ${row.questions})`);
    }
  }

  return `-- Ten test friends. Generated by scripts/seed-test-friends.ts — edit the script
-- and regenerate rather than editing this file.
--
-- Idempotent: every insert upserts, so applying it twice leaves the same ten
-- accounts with the same numbers. The undo is at the end.
--
-- The profiles land in a temporary table first so the list is stated once and
-- every derived table reads from it, rather than the same ten rows being
-- repeated seven times over.

BEGIN;

CREATE TEMP TABLE seed_friends (
  user_id     TEXT PRIMARY KEY,
  handle      TEXT NOT NULL,
  country     TEXT NOT NULL,
  ink         TEXT NOT NULL,
  initials    TEXT NOT NULL,
  correct     INTEGER NOT NULL,
  questions   INTEGER NOT NULL,
  cur_streak  INTEGER NOT NULL,
  long_streak INTEGER NOT NULL,
  seen_ago    INTEGER NOT NULL,
  quest_xp    INTEGER NOT NULL,
  levels      JSONB NOT NULL,
  crown       BOOLEAN NOT NULL,
  pair_low    TEXT NOT NULL,
  pair_high   TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO seed_friends VALUES
${profiles.join(',\n')};

CREATE TEMP TABLE seed_friend_categories (
  user_id   TEXT NOT NULL,
  category  TEXT NOT NULL,
  correct   INTEGER NOT NULL,
  questions INTEGER NOT NULL
) ON COMMIT DROP;

INSERT INTO seed_friend_categories VALUES
${categories.join(',\n')};

-- Allocate before user_stats' default-name trigger. Existing identities keep
-- their current name; numbers are allocated atomically and never recycled.
DO $$ DECLARE s RECORD; base TEXT; BEGIN
  FOR s IN SELECT user_id, handle FROM seed_friends ORDER BY user_id LOOP
    base := regexp_replace(initcap(replace(s.handle, '-', ' ')), ' ', '', 'g');
    base := lower(left(base, 1)) || substr(base, 2);
    PERFORM public.allocate_shark_name('user:' || s.user_id, base, s.user_id, FALSE);
  END LOOP;
END; $$;

-- The accounts. No name and no email: these are not people, and a fabricated
-- name in the column an OAuth provider fills is the kind of fake data that
-- later gets mistaken for real.
INSERT INTO public.user_stats
  (user_id, name, email, picture, total_quizzes, total_correct, total_questions,
   current_streak, longest_streak, last_quiz_date)
SELECT s.user_id, NULL, NULL, ${AVATAR_SQL}, GREATEST(1, ROUND(s.questions / 8.0)::INT),
       s.correct, s.questions, s.cur_streak, s.long_streak, CURRENT_DATE - s.seen_ago
  FROM seed_friends s
ON CONFLICT (user_id) DO UPDATE SET
  picture = EXCLUDED.picture, total_quizzes = EXCLUDED.total_quizzes,
  total_correct = EXCLUDED.total_correct, total_questions = EXCLUDED.total_questions,
  current_streak = EXCLUDED.current_streak, longest_streak = EXCLUDED.longest_streak,
  last_quiz_date = EXCLUDED.last_quiz_date;

UPDATE public.user_handles h SET country = s.country, discoverable = TRUE
FROM seed_friends s WHERE h.user_id = s.user_id;

INSERT INTO public.user_category_stats (user_id, category, total_correct, total_questions)
SELECT c.user_id, c.category, c.correct, c.questions FROM seed_friend_categories c
ON CONFLICT (user_id, category) DO UPDATE SET
  total_correct = EXCLUDED.total_correct, total_questions = EXCLUDED.total_questions;

INSERT INTO public.user_xp (user_id, quest_xp, quest_xp_by_subject)
SELECT s.user_id, s.quest_xp, jsonb_build_object(${quote(SUBJECT)}, s.quest_xp) FROM seed_friends s
ON CONFLICT (user_id) DO UPDATE SET
  quest_xp = EXCLUDED.quest_xp, quest_xp_by_subject = EXCLUDED.quest_xp_by_subject;

INSERT INTO public.roadmap_progress (user_id, data)
SELECT s.user_id, s.levels FROM seed_friends s
ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data;

INSERT INTO public.cosmetic_entitlements (user_id, cosmetic_id, equipped)
SELECT s.user_id, 'crown', TRUE FROM seed_friends s WHERE s.crown
ON CONFLICT (user_id, cosmetic_id) DO UPDATE SET equipped = TRUE;

-- This fixture works with both versions of the relationship key. Never
-- overwrite a block or turn a muted pending row into an accepted friendship.
LOCK TABLE public.friendships IN SHARE ROW EXCLUSIVE MODE;
UPDATE public.friendships f
   SET state = 'accepted', responded_at = NOW()
  FROM seed_friends s
 WHERE f.user_low = s.pair_low AND f.user_high = s.pair_high AND f.blocked_by IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.friendships b
      WHERE b.user_low = s.pair_low AND b.user_high = s.pair_high AND b.blocked_by IS NOT NULL
   );
INSERT INTO public.friendships (user_low, user_high, requested_by, state, responded_at)
SELECT s.pair_low, s.pair_high, s.user_id, 'accepted', NOW()
  FROM seed_friends s
 WHERE NOT EXISTS (
   SELECT 1 FROM public.friendships b
    WHERE b.user_low = s.pair_low AND b.user_high = s.pair_high AND b.blocked_by IS NOT NULL
 )
ON CONFLICT DO NOTHING;

COMMIT;

-- Undo:
--   DELETE FROM public.friendships WHERE user_low LIKE 'seed-friend-%' OR user_high LIKE 'seed-friend-%';
--   DELETE FROM public.cosmetic_entitlements WHERE user_id LIKE 'seed-friend-%';
--   DELETE FROM public.roadmap_progress    WHERE user_id LIKE 'seed-friend-%';
--   DELETE FROM public.user_xp             WHERE user_id LIKE 'seed-friend-%';
--   DELETE FROM public.user_category_stats WHERE user_id LIKE 'seed-friend-%';
--   DELETE FROM public.user_handles        WHERE user_id LIKE 'seed-friend-%';
--   DELETE FROM public.user_stats          WHERE user_id LIKE 'seed-friend-%';`;
}

/* ── entry point ───────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const ownerIndex = args.findIndex((arg) => arg === '--owner');
const owner = ownerIndex >= 0 ? args[ownerIndex + 1] : args.find((arg) => arg.startsWith('--owner='))?.split('=')[1];

if (!owner || owner.trim() === '') {
  // The owner id is not baked into this file on purpose: it identifies a real
  // account, and a seed script is not the place to keep one.
  process.stderr.write('Usage: npm run seed:test-friends -- --owner <user_id>\n');
  process.stderr.write('The owner is the account the ten are befriended with.\n');
  process.exit(2);
}
if (owner.startsWith(ID_PREFIX)) {
  process.stderr.write(`The owner cannot be one of the seeded accounts (${ID_PREFIX}…).\n`);
  process.exit(2);
}

process.stdout.write(`${seedSql(owner.trim())}\n`);
