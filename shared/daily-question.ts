/** The question of the day (#239): one public devShark question a day at
 * /daily, from a different track each day.
 *
 * The track is a pure function of the date, so the build can draw each day's
 * share image (title, track, date) and write each day's page head before the
 * day comes, and the server picks that day's question from the same track at
 * request time (`lib/daily-question.ts`), from the bank it serves everywhere
 * else. Which question it is, its options and its answer stay on the server
 * until a learner checks an answer.
 *
 * It is practice only: the session it hands out is marked `qotd`, and
 * `api/quiz/submit.ts` grades it as it grades a signed-out quiz, so it never
 * mints a receipt, XP, a streak day, a leaderboard entry or a review record,
 * whoever is signed in. This module is pure. */

/** The first date with a question of the day: the rotation counts from it. */
export const QOTD_EPOCH = '2026-09-01';

/** The rotation, one track a day, frontend and backend interleaved. Every
 * entry is a served quiz category with a deep pool of questions; the launch
 * contracts check both. */
export const QOTD_TRACKS = [
  'javascript', 'react', 'databases', 'css', 'nodejs', 'typescript', 'git', 'html',
  'security', 'nextjs', 'system-design', 'devops', 'ai', 'dsa', 'general',
] as const;
export type QotdTrack = (typeof QOTD_TRACKS)[number];

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date written YYYY-MM-DD. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/** Today in UTC, the day the daily challenge uses too. */
export const utcToday = (now: number = Date.now()): string => new Date(now).toISOString().slice(0, 10);

/** Whole days from `from` to `to`, both YYYY-MM-DD. */
export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

export const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** The track of a day's question. */
export function qotdTrack(date: string): QotdTrack {
  const index = daysBetween(QOTD_EPOCH, date) % QOTD_TRACKS.length;
  return QOTD_TRACKS[(index + QOTD_TRACKS.length) % QOTD_TRACKS.length];
}

/** Whether a date has a question yet: from the first day up to today. */
export type QotdAvailability = 'open' | 'not-yet' | 'before-start';
export function qotdAvailability(date: string, today: string = utcToday()): QotdAvailability {
  if (date < QOTD_EPOCH) return 'before-start';
  if (date > today) return 'not-yet';
  return 'open';
}

/** The question an entry URL can open without asking the server for an unavailable date. */
export function openQotdDate(pathname: string): string | null {
  const match = /^\/daily(?:\/(\d{4}-\d{2}-\d{2}))?\/?$/i.exec(pathname);
  if (!match) return null;
  const today = utcToday();
  const date = match[1] ?? today;
  return isIsoDate(date) && qotdAvailability(date, today) === 'open' ? date : null;
}

/** The public page of one day's question; /daily shows today's. */
export const qotdPath = (date?: string): string => (date ? `/daily/${date}` : '/daily');

/** The share image the build draws for a day, 1200 × 630. */
export const qotdImagePath = (date: string): string => `/og/daily/${date}.png`;

/** GET /api/quiz/daily?qotd=<YYYY-MM-DD|today>. */
export interface QotdResponse {
  date: string;
  track: QotdTrack;
  /** Sealed like every quiz session: the answer is inside, encrypted. */
  sessionId: string;
  question: {
    id: string;
    question: string;
    introduction?: string;
    options: string[];
    category: string;
    difficulty: number;
  };
}

/** Error codes of that endpoint besides the shared ones. */
export const QOTD_NOT_YET = 'qotd_not_yet';
export const QOTD_BEFORE_START = 'qotd_before_start';
