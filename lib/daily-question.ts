/** The question of the day on the server (#239).
 *
 *   GET /api/quiz/daily?qotd=<YYYY-MM-DD|today>
 *
 * Served by `api/quiz/daily.ts` so the handler count stays at twelve. The day's
 * track comes from `shared/daily-question.ts`; the question is a seeded pick
 * from that track in the bank every quiz is served from (the /dev edits and
 * the eligibility gate applied), preferring questions of importance 4 or 5 as
 * the daily challenge does. The same date always gives the same question and
 * the same option order, so a post that links to a day shows what it
 * promised.
 *
 * The answer never leaves in this response: it is sealed into a quiz session
 * marked `qotd`, which `api/quiz/submit.ts` grades like a signed-out quiz. So
 * checking an answer records nothing for anyone: no receipt, no XP, no streak,
 * no leaderboard, no review state. A future date is refused, so nobody can
 * read tomorrow's question today. */
import { createHash } from 'node:crypto';
import type { VercelRequest, VercelResponse } from './vercel-types.js';
import { encodeSession } from './quiz-tokens';
import { PRIVATE_CATEGORIES } from './quiz-runtime';
import { jsonError } from './http';
import { getEffectiveQuestions } from './questions-store';
import { enforceClassRateLimit, RATE_LIMITS } from './rate-limit';
import {
  isIsoDate,
  qotdAvailability,
  qotdTrack,
  utcToday,
  QOTD_BEFORE_START,
  QOTD_NOT_YET,
  type QotdResponse,
} from '../shared/daily-question';

/** Deterministic seeded shuffle: the same seed always gives the same order,
 * and every order is equally likely. Each swap draws a 32-bit word from
 * SHA-256 of `${seed}:${block}`, eight words a block, and redraws a word past
 * the largest multiple of the range, so no index is favoured. */
export function seededShuffle<T>(arr: T[], seed: string): T[] {
  const out = [...arr];
  let block = 0;
  let words = Buffer.alloc(0);
  let offset = 0;
  const draw = (): number => {
    if (offset >= words.length) {
      words = createHash('sha256').update(`${seed}:${block++}`).digest();
      offset = 0;
    }
    const word = words.readUInt32BE(offset);
    offset += 4;
    return word;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const range = i + 1;
    const limit = Math.floor(0x1_0000_0000 / range) * range;
    let word = draw();
    while (word >= limit) word = draw();
    const j = word % range;
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The shuffle used before `UNBIASED_SHUFFLE_FROM`. It took one hash byte per
 * swap, modulo the range, cycling through 32 bytes: in a pool of more than
 * 256 questions nothing past position 255 could come first, and the early
 * positions came up far more often. Kept only so the days already published
 * keep the question and order they showed. */
function legacySeededShuffle<T>(arr: T[], seed: string): T[] {
  const out = [...arr];
  const hash = createHash('sha256').update(seed).digest();
  let cursor = 0;
  for (let i = out.length - 1; i > 0; i--) {
    if (cursor >= hash.length) cursor = 0;
    const j = hash[cursor++] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The first day the daily challenge and the question of the day are drawn
 * with the unbiased shuffle. Earlier days keep the draw they were published
 * with, so an old /daily/<date> link and a day's leaderboard still show the
 * questions they were about. */
export const UNBIASED_SHUFFLE_FROM = '2026-10-01';

/** The shuffle for one day's daily challenge or question of the day. */
export function dailySeededShuffle<T>(arr: T[], seed: string, date: string): T[] {
  return date < UNBIASED_SHUFFLE_FROM ? legacySeededShuffle(arr, seed) : seededShuffle(arr, seed);
}

type Picked = Omit<QotdResponse, 'sessionId'> & { correctAnswer: number };

/** A day's question with its answer, or null when its track has none. */
export function pickQuestionOfTheDay(
  questions: readonly { id: string; category: string; importance?: number; question: string; introduction?: string; options: string[]; correctAnswer: number; difficulty: number; tags?: string[] }[],
  date: string,
): Picked | null {
  const track = qotdTrack(date);
  const pool = questions.filter((q) => q.category === track && !(PRIVATE_CATEGORIES as string[]).includes(q.category) && q.options.length >= 2);
  if (pool.length === 0) return null;
  const worthy = pool.filter((q) => (q.importance ?? 5) >= 4);
  const base = dailySeededShuffle(worthy.length >= 10 ? worthy : pool, `qotd::${date}`, date)[0];
  const correctText = base.options[base.correctAnswer];
  const options = dailySeededShuffle(base.options, `qotd::${date}::${base.id}::opts`, date);
  return {
    date,
    track,
    correctAnswer: options.indexOf(correctText),
    question: {
      id: base.id,
      question: base.question,
      ...(base.introduction ? { introduction: base.introduction } : {}),
      options,
      category: base.category,
      difficulty: base.difficulty,
      // No tags before grading: some name the correct option.
    },
  };
}

export async function handleQuestionOfTheDay(req: VercelRequest, res: VercelResponse) {
  if (!(await enforceClassRateLimit(req, res, RATE_LIMITS.quizSessionAddress, RATE_LIMITS.quizSession))) return;
  const raw = typeof req.query.qotd === 'string' ? req.query.qotd : '';
  const now = Date.now();
  const today = utcToday(now);
  const date = raw === '' || raw === 'today' ? today : raw;
  if (!isIsoDate(date)) return jsonError(res, 400, 'bad_request', 'qotd must be a date as YYYY-MM-DD, or today');

  const availability = qotdAvailability(date, today);
  if (availability === 'not-yet') {
    // A response stored just before midnight must stop being fresh when the
    // question opens. A longer public lifetime is still useful earlier.
    const opensAt = Date.parse(`${date}T00:00:00Z`);
    const seconds = Math.min(60, Math.floor((opensAt - now) / 1000));
    res.setHeader('Cache-Control', `public, max-age=${seconds}`);
    return jsonError(res, 404, QOTD_NOT_YET, 'This question of the day is not out yet.');
  }
  if (availability === 'before-start') {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return jsonError(res, 404, QOTD_BEFORE_START, 'There was no question of the day on that date.');
  }

  const questions = await getEffectiveQuestions('webdev');
  const picked = pickQuestionOfTheDay(questions, date);
  if (!picked) return jsonError(res, 503, 'no_questions', 'The question of the day is not available right now.');

  const { correctAnswer, ...answer } = picked;
  const sessionId = encodeSession([{ questionId: picked.question.id, correctAnswer }], { scope: 'qotd', date, subject: 'webdev' });
  // The body carries a sealed session, which one check claims. Keep it out of
  // every cache: a browser that kept it for five minutes answered "Load it
  // again" after a 409 with the same claimed session, and the page stayed on
  // the expired banner.
  res.setHeader('Cache-Control', 'private, no-store');
  const body: QotdResponse = { ...answer, sessionId };
  return res.json(body);
}
