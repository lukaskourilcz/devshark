/** GET /api/quiz/roadmap?resource=lesson&id=<lesson id> (#492).
 *
 * The lesson a Learn level opens with. Public reading, the same for every
 * caller: guests are served, no token is verified, nothing is recorded. It
 * takes the Learn map's limit, the address tier alone (`RATE_LIMITS.
 * readAddress`), for the same reason the map does: verifying a token would
 * cost a round trip the answer never needed.
 *
 * The body changes only when the lesson text does, so the answer carries the
 * projection's sha256 as a strong ETag and may be cached publicly; a read
 * that names the current hash in If-None-Match gets a 304 with no body. */

import type { VercelRequest, VercelResponse } from '../vercel-types.js';
import type { LearnLessonResponse } from '../../shared/learning-path-api';
import { jsonError } from '../http';
import { enforceRateLimit, RATE_LIMITS } from '../rate-limit';
import { matchesEntityTag } from '../public-json';
import { publicLesson } from './index';

/** Five minutes in a browser, a day at the CDN; a deployment clears the CDN,
 * and the ETag makes a revalidation cheap either way. */
export const LESSON_CACHE_CONTROL = 'public, max-age=300, s-maxage=86400';

const LESSON_ID = /^[a-z0-9-]{1,80}$/;

export async function handleLessonRead(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  if (!(await enforceRateLimit(req, res, RATE_LIMITS.readAddress))) return;
  const id = typeof req.query.id === 'string' ? req.query.id : '';
  if (!LESSON_ID.test(id)) return jsonError(res, 400, 'bad_request', 'Invalid lesson id');
  const entry = publicLesson(id);
  if (!entry) return jsonError(res, 404, 'not_found', 'Unknown lesson');

  const etag = `"${entry.hash}"`;
  res.setHeader('Cache-Control', LESSON_CACHE_CONTROL);
  res.setHeader('ETag', etag);
  if (matchesEntityTag(req.headers['if-none-match'], etag)) return res.status(304).end();
  const body: LearnLessonResponse = { lesson: entry.lesson, hash: entry.hash };
  return res.json(body);
}
