import type { VercelRequest, VercelResponse } from '../../lib/vercel-types.js';
import { secureShuffle } from '../../lib/quiz-runtime';
import {
  supabase,
  jsonError,
  isShortString,
  logEvent,
  generateMatchCode,
  withTimeout,
} from '../../lib/play-helpers';
import { requireAuthResult, requireAuthSub, isRpcMissing, withRequestContext, ServiceUnavailableError } from '../../lib/http';
import { roomDisplayName } from '../../lib/public-identity';
import { tryAuth } from '../../lib/auth';
import { getEffectiveQuestions } from '../../lib/questions-store';
import { getGameSettings } from '../../lib/settings-store';
import { enforceRateLimit, RATE_LIMITS, type RateLimitConfig } from '../../lib/rate-limit';
import { deploymentSubjectIds, validateCategoryScope } from '../../lib/product-scope';

const PING_GRACE_MS = 1000;
const STALE_MATCH_MS = 5 * 60 * 1000;
// Extra slack past the per-question time limit before the server force-advances
// a multiplayer question, so a client's on-the-buzzer submit still lands.
const QUESTION_EXPIRE_GRACE_MS = 2000;

// Columns re-selected after a lazy server-side advance in state(); must match
// the state() select list so the refreshed row can replace the original.
const STATE_COLUMNS =
  'id, code, mode, subject, host_id, host_name, status, current_index, questions, ended_at, question_started_at, question_duration_s, last_heartbeat_at, started_at, revealed_idx';

interface MatchQuestion {
  id: string;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
  category: string;
  difficulty: number;
}

function computeSpeedBonus(elapsedMs: number, durationS: number, maxBonus: number): number {
  // With no time limit there is no speed component — score the answer flat.
  if (durationS <= 0) return 0;
  if (elapsedMs <= 0) return maxBonus;
  const fraction = Math.max(0, 1 - elapsedMs / (durationS * 1000));
  return Math.round(fraction * maxBonus);
}

// In multiplayer everyone competes (the host included), so only classroom
// hosts get the answer key while a match is running. Everyone sees it once
// the match is finished.
function canSeeAnswers(match: { mode: string; host_id: string; status: string }, sub: string | null): boolean {
  if (match.status === 'finished') return true;
  return match.mode === 'classroom' && sub !== null && sub === match.host_id;
}

// The questions a viewer may read. Whoever may see the answers gets every
// question with its key. Everyone else gets only the questions already shown
// (none in the lobby, up to the current one while the room runs), without the
// answer key and without the explanation, which usually spells the answer
// out. `question_count` carries the length of the round. Shared by join() and
// state() so the two endpoints can't drift apart.
function sanitizeQuestions(
  match: { mode: string; host_id: string; status: string; current_index: number | null; questions: unknown },
  sub: string | null,
): Array<Record<string, unknown>> {
  const questions = Array.isArray(match.questions) ? (match.questions as Array<Record<string, unknown>>) : [];
  if (canSeeAnswers(match, sub)) return questions;
  const shown = match.status === 'running' ? questions.slice(0, (match.current_index ?? 0) + 1) : [];
  return shown.map((q) => {
    const { correct_index: _ci, explanation: _e, ...rest } = q;
    return rest;
  });
}

const questionCount = (match: { questions: unknown }): number =>
  Array.isArray(match.questions) ? match.questions.length : 0;

/** The current question's clock has run out, with the grace an answer sent on
 * the buzzer gets, on the server's clock. A question with no limit never does. */
function pastAnswerWindow(
  match: { question_started_at?: string | null; question_duration_s?: number | null },
  nowMs: number,
): boolean {
  const limitS = match.question_duration_s ?? 0;
  const startedMs = match.question_started_at ? new Date(match.question_started_at).getTime() : null;
  return limitS > 0 && startedMs !== null && nowMs > startedMs + limitS * 1000 + QUESTION_EXPIRE_GRACE_MS;
}

/** While a classroom room runs, its scoreboard counts only the questions that
 * are closed: every question before the current one, and the current one once
 * the teacher revealed its answer or its clock ran out. A live count of the
 * open question would tell a projected room which option scores. Null for
 * every other room, which counts every answer. */
function scoreboardBeforeIdx(
  match: {
    mode: string;
    status: string;
    current_index: number | null;
    revealed_idx?: number | null;
    question_started_at?: string | null;
    question_duration_s?: number | null;
  },
  nowMs: number,
): number | null {
  if (match.mode !== 'classroom' || match.status !== 'running') return null;
  const current = match.current_index ?? 0;
  const closed = match.revealed_idx === current || pastAnswerWindow(match, nowMs);
  return closed ? current + 1 : current;
}

// Move a running match to its next question — or finish it after the last
// one. The conditional update (status + current_index must still match what
// we read) makes concurrent calls advance at most once.
async function tryAdvance(match: {
  id: string;
  status: string;
  current_index: number | null;
  questions: unknown;
}): Promise<Record<string, unknown> | null> {
  const total = Array.isArray(match.questions) ? match.questions.length : 0;
  const nextIdx = (match.current_index ?? 0) + 1;
  const now = new Date().toISOString();
  const patch: Record<string, unknown> =
    nextIdx >= total
      ? { status: 'finished', ended_at: now, last_heartbeat_at: now }
      : { current_index: nextIdx, question_started_at: now, last_heartbeat_at: now };

  const { data } = await withTimeout(
    supabase!
      .from('matches')
      .update(patch)
      .eq('id', match.id)
      .eq('status', 'running')
      .eq('current_index', match.current_index ?? 0)
      .select(STATE_COLUMNS),
  );
  return data && data.length > 0 ? (data[0] as Record<string, unknown>) : null;
}

/** The answer for an exception an action caught. A Supabase call that timed
 * out (lib/http.ts `UpstreamTimeoutError`) is the database busy for a moment,
 * which a client may retry: 503 with its code, as every handler answers it.
 * Anything else is a fault here, logged as one, and no timeout. */
function caughtError(route: string, res: VercelResponse, err: unknown) {
  const message = err instanceof Error ? err.message : 'unknown';
  if (err instanceof ServiceUnavailableError) {
    logEvent(route, { status: 503, error: message });
    return jsonError(res, 503, err.code, err.message);
  }
  logEvent(route, { level: 'error', status: 500, error: message });
  return jsonError(res, 500, 'internal_error', 'Internal error');
}

async function routeHandler(req: VercelRequest, res: VercelResponse) {
  if (!supabase) return jsonError(res, 503, 'not_configured', 'Match backend is not configured');

  // Two tiers (ported from fa884b7). These route-level buckets are keyed by
  // client address and sized for a whole class behind one NAT: a teacher
  // reads a code aloud and thirty pupils join from one address, which buckets
  // sized for one person turned into a wall of 429s. They are a coarse
  // backstop. Each handler below takes a second token from a bucket keyed by
  // the caller's verified account (`user:<id>`), at the rate these buckets
  // used to carry, so no learner gained anything; and `state`, the one action
  // a caller without an account may complete, keeps the old address limit
  // for that caller.
  const action = String(req.query.action || '').toLowerCase();
  if (req.method === 'GET' && action === 'state') {
    if (!(await enforceRateLimit(req, res, RATE_LIMITS.playState))) return;
  } else if (req.method !== 'GET') {
    const policy: RateLimitConfig = action === 'create'
      ? RATE_LIMITS.playCreate
      : action === 'join'
        ? RATE_LIMITS.playJoin
        : RATE_LIMITS.playMutation;
    if (!(await enforceRateLimit(req, res, policy))) return;
  }

  // The Play switch in /dev → Settings turns the whole feature off, rooms
  // already open included, not only its nav entry.
  if (!(await getGameSettings()).features.multiplayer) {
    return jsonError(res, 503, 'feature_disabled', 'Live games are switched off');
  }

  switch (action) {
    case 'create':
      return create(req, res);
    case 'join':
      return join(req, res);
    case 'state':
      return state(req, res);
    case 'control':
      return control(req, res);
    case 'answer':
      return answer(req, res);
    case 'distribution':
      return distribution(req, res);
    case 'heartbeat':
      return heartbeat(req, res);
    default:
      return jsonError(res, 404, 'unknown_action', `Unknown play action: ${action}`);
  }
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  return withRequestContext(req, res, () => routeHandler(req, res));
}

async function create(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  const hostAuth = await requireAuthResult(req, res);
  if (!hostAuth) return;
  const hostSub = hostAuth.sub;
  if (!(await enforceRateLimit(req, res, RATE_LIMITS.playCreatePerUser, `user:${hostSub}`))) return;

  // A body's `host_name` is ignored: the room names its host itself.
  const body = (req.body || {}) as {
    mode?: unknown;
    count?: unknown;
    categories?: unknown;
    duration_s?: unknown;
  };

  const { play: playSettings } = await getGameSettings();
  const mode = body.mode === 'classroom' ? 'classroom' : 'multiplayer';
  const requestedCount = typeof body.count === 'number' ? body.count : 10;
  const count = Math.min(
    Math.max(Math.floor(requestedCount), playSettings.minQuestions),
    playSettings.maxQuestions,
  );
  // Per-question time limit chosen by the host. Falls back to the default when
  // omitted or not one of the allowed values; 0 means "no limit".
  const durationS =
    typeof body.duration_s === 'number' && playSettings.durationOptionsS.includes(body.duration_s)
      ? body.duration_s
      : playSettings.defaultDurationS;
  // A list with an entry that is not a topic id is malformed as a whole: the
  // room is not opened on whatever part of it happened to be strings.
  if (body.categories !== undefined && (!Array.isArray(body.categories) || body.categories.length > 64
    || body.categories.some((c) => typeof c !== 'string'))) {
    return jsonError(res, 400, 'bad_request', 'categories must be a list of topic ids');
  }
  let categories = (body.categories ?? []) as string[];

  // The client always sends the active subject's category list (or a subset
  // of it), so an empty list is a malformed request — falling back to the
  // whole bank would leak questions from other subjects into the match. The
  // message targets the one real sender: a pre-deploy tab with a stale bundle.
  if (categories.length === 0) {
    return jsonError(res, 400, 'bad_request', 'No topics selected — refresh the page and try again');
  }
  const scope = validateCategoryScope(categories, { forDelivery: true });
  if (!scope.ok) {
    return jsonError(res, 400, 'invalid_subject_scope', 'Topics must belong to this deployment and one subject');
  }
  categories = scope.categories;

  // The host's name (the Google name, the sharkname, or "Player" and a
  // number; never anything from the address, lib/public-identity.ts) is
  // worked out while the question bank loads.
  const [hostName, allQuestions] = await Promise.all([
    roomDisplayName(hostAuth, supabase),
    getEffectiveQuestions(scope.subject),
  ]);
  const pool = allQuestions.filter((q) => categories.includes(q.category));
  if (pool.length < playSettings.minQuestions) {
    return jsonError(res, 400, 'too_few_questions', 'Not enough questions for these filters');
  }

  const selected = secureShuffle(pool).slice(0, count);
  const matchQuestions = selected.map((q) => {
    const correctText = q.options[q.correctAnswer];
    const opts = secureShuffle(q.options);
    return {
      id: q.id,
      question: q.question,
      options: opts,
      correct_index: opts.indexOf(correctText),
      explanation: q.explanation,
      category: q.category,
      difficulty: q.difficulty,
    };
  });

  const insertRoom = (code: string) => withTimeout(
    supabase!
      .from('matches')
      .insert({
        code,
        mode,
        subject: scope.subject,
        host_id: hostSub,
        host_name: hostName,
        status: 'lobby',
        questions: matchQuestions,
        current_index: 0,
        question_duration_s: durationS,
        last_heartbeat_at: new Date().toISOString(),
      })
      .select('id, code, mode, host_id, host_name, status')
      .single(),
  );

  let code = generateMatchCode();
  try {
    // The unique key on matches.code decides a clash, so two hosts drawing
    // the same code at once cannot both pass a read first and then fail the
    // insert with a 500. A clash draws a new code and tries again.
    let { data, error } = await insertRoom(code);
    for (let attempt = 1; attempt < 5 && error?.code === '23505'; attempt++) {
      code = generateMatchCode();
      ({ data, error } = await insertRoom(code));
    }

    if (error || !data) {
      logEvent('play/create', { status: 500, error: error?.message });
      return jsonError(res, 500, 'db_error', 'Could not create match');
    }

    const hostInsert = await withTimeout(
      supabase!
        .from('match_participants')
        .insert({ match_id: data.id, user_id: hostSub, display_name: hostName }),
    );
    if (hostInsert.error) {
      await withTimeout(supabase!.from('matches').delete().eq('id', data.id)).catch(() => undefined);
      logEvent('play/create', { status: 500, category: 'participant_insert', error: hostInsert.error.message });
      return jsonError(res, 500, 'db_error', 'Could not create match participant');
    }

    logEvent('play/create', { status: 200, code, mode, count });
    return res.json({
      id: data.id,
      code: data.code,
      mode: data.mode,
      host_id: data.host_id,
      host_name: data.host_name,
      status: data.status,
    });
  } catch (err) {
    return caughtError('play/create', res, err);
  }
}

async function join(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  const auth = await requireAuthResult(req, res);
  if (!auth) return;
  const sub = auth.sub;
  if (!(await enforceRateLimit(req, res, RATE_LIMITS.playJoinPerUser, `user:${sub}`))) return;

  // A body's `display_name` is ignored, as the host's is: an older client sent
  // the part of the address before the @ for an account without a Google name.
  const body = (req.body || {}) as { code?: unknown };
  if (!isShortString(body.code, 16)) return jsonError(res, 400, 'bad_request', 'code required');

  const code = body.code.toUpperCase();
  try {
    // The player's name is worked out while the room is read: a class joins
    // from one code at once, and the two waits added up for every pupil.
    // roomDisplayName never throws; it falls back to "Player" and a number.
    const [{ data: match, error }, displayName] = await Promise.all([
      withTimeout(
        supabase!
          .from('matches')
          .select(
            'id, code, mode, subject, host_id, host_name, status, current_index, questions, question_started_at, question_duration_s, revealed_idx',
          )
          .eq('code', code)
          .in('subject', deploymentSubjectIds())
          .maybeSingle(),
      ),
      roomDisplayName(auth, supabase),
    ]);

    if (error) {
      logEvent('play/join', { status: 500, error: error.message });
      return jsonError(res, 500, 'db_error', 'Could not look up match');
    }
    if (!match) return jsonError(res, 404, 'not_found', 'No match with that code');
    if (match.status === 'finished') return jsonError(res, 410, 'finished', 'Match is over');

    const participantInsert = await withTimeout(
      supabase!.from('match_participants').upsert(
        { match_id: match.id, user_id: sub, display_name: displayName },
        { onConflict: 'match_id,user_id' },
      ),
    );
    if (participantInsert.error) {
      logEvent('play/join', { status: 500, category: 'participant_upsert', error: participantInsert.error.message });
      return jsonError(res, 500, 'db_error', 'Could not join match');
    }

    const sanitized = sanitizeQuestions(match, sub);

    logEvent('play/join', { status: 200, code });
    return res.json({
      id: match.id,
      code: match.code,
      mode: match.mode,
      subject: match.subject,
      status: match.status,
      host_id: match.host_id,
      host_name: match.host_name,
      current_index: match.current_index,
      question_started_at: match.question_started_at,
      question_duration_s: match.question_duration_s,
      revealed_idx: match.revealed_idx ?? null,
      questions: sanitized,
      question_count: questionCount(match),
      // The clients count each question down against the server's clock, so
      // a device clock that is off neither closes nor reveals a question early.
      server_now: new Date().toISOString(),
    });
  } catch (err) {
    return caughtError('play/join', res, err);
  }
}

async function state(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  // State is public to room-code holders. Validate the code before performing
  // optional remote authentication so malformed probes remain cheap. A code
  // repeated in the query string arrives as an array, which is no code.
  if (!isShortString(req.query.code, 16)) return jsonError(res, 400, 'bad_request', 'code required');
  const code = req.query.code.toUpperCase();
  const auth = await tryAuth(req);
  const sub = auth?.sub ?? null;

  // The route-level `playState` bucket holds a whole class, which is no abuse
  // limit on its own. Split it here, where the caller is known: a signed-in
  // caller is bounded per account, and a caller without one keeps the address
  // limit this endpoint had before the class-sized bucket. Both run before
  // the match is read, so neither costs a query.
  const stateLimit = sub
    ? await enforceRateLimit(req, res, RATE_LIMITS.playStatePerUser, `user:${sub}`)
    : await enforceRateLimit(req, res, RATE_LIMITS.playStateAnonymous);
  if (!stateLimit) return;

  try {
    let { data: match, error: matchError } = await withTimeout(
      supabase!.from('matches').select(STATE_COLUMNS).eq('code', code).in('subject', deploymentSubjectIds()).maybeSingle(),
    );

    if (matchError) {
      logEvent('play/state', { status: 503, category: 'match_read', error: matchError.message });
      return jsonError(res, 503, 'backend_unavailable', 'Match state is temporarily unavailable');
    }

    if (!match) return jsonError(res, 404, 'not_found', 'Match not found');

    // Lazy auto-finish ghost matches: a host who stopped sending heartbeats
    // left a running room, or a lobby that will never start.
    if (match.status === 'running' || match.status === 'lobby') {
      const ref = match.last_heartbeat_at ?? match.started_at;
      if (ref && Date.now() - new Date(ref).getTime() > STALE_MATCH_MS) {
        const finish = supabase!
          .from('matches')
          .update({ status: 'finished', ended_at: new Date().toISOString() })
          .eq('id', match.id)
          .eq('status', match.status);
        // A heartbeat can arrive after the read without changing the status.
        // Close only the version whose heartbeat we found stale.
        const unchanged = match.last_heartbeat_at == null
          ? finish.is('last_heartbeat_at', null)
          : finish.eq('last_heartbeat_at', match.last_heartbeat_at);
        const { data: updated } = await withTimeout(unchanged.select(STATE_COLUMNS).maybeSingle());
        if (updated) match = updated;
      }
    }

    // Multiplayer matches advance themselves — nobody "runs" the questions.
    // Timed questions advance from answer() (all answered) with the expiry
    // check below as backstop; only no-limit matches need the per-poll
    // answered count (their only other trigger is answer() itself, and this
    // heals the rare race where two final answers miss each other).
    const durationS = match.question_duration_s ?? 0;
    const runningMultiplayer = match.status === 'running' && match.mode === 'multiplayer';
    const needAnsweredCount = runningMultiplayer && durationS <= 0;

    // A running classroom counts only its closed questions (056); every
    // other room counts every answer, through the call as it always was.
    const beforeIdx = scoreboardBeforeIdx(match, Date.now());

    // Fetch participants + scoreboard (+ the answered count when needed)
    // concurrently instead of sequentially.
    const [participantsRes, scoreboardRes, answersCountRes] = await Promise.all([
      withTimeout(
        supabase!
          .from('match_participants')
          .select('user_id, display_name, joined_at')
          .eq('match_id', match.id)
          .order('joined_at', { ascending: true }),
      ),
      withTimeout(supabase!.rpc(
        'match_scoreboard',
        beforeIdx === null ? { p_match_id: match.id } : { p_match_id: match.id, p_before_idx: beforeIdx },
      )),
      needAnsweredCount
        ? withTimeout(
            supabase!
              .from('match_answers')
              .select('user_id', { count: 'exact', head: true })
              .eq('match_id', match.id)
              .eq('question_idx', match.current_index ?? 0),
          )
        : Promise.resolve(null),
    ]);
    if (participantsRes.error || scoreboardRes.error || answersCountRes?.error) {
      logEvent('play/state', {
        status: 503,
        category: 'state_dependencies',
        participants: participantsRes.error?.message,
        scoreboard: scoreboardRes.error?.message,
        answers: answersCountRes?.error?.message,
      });
      return jsonError(res, 503, 'backend_unavailable', 'Match state is temporarily unavailable');
    }

    if (runningMultiplayer) {
      const expired = pastAnswerWindow(match, Date.now());
      const participantCount = participantsRes.data?.length ?? 0;
      const allAnswered =
        participantCount > 0 && (answersCountRes?.count ?? 0) >= participantCount;

      if (expired || allAnswered) {
        const bumped = await tryAdvance(match);
        if (bumped) match = bumped as typeof match;
        else {
          // A read or an answer at the same moment moved the room on first.
          // Send the room as it left it, not the question that just closed:
          // each client reads once when the clock runs out and would wait
          // for the next poll on a stale answer.
          const { data: moved } = await withTimeout(
            supabase!.from('matches').select(STATE_COLUMNS).eq('id', match.id).maybeSingle(),
          );
          if (moved) match = moved as typeof match;
        }
      }
    }

    // A classroom host presents and never answers, so they get no scoreboard
    // row: in a room where nobody scored, their zero time would top it.
    const hostPresents = match.mode === 'classroom';
    const scoreboard = ((scoreboardRes.data ?? []) as Array<{ user_id: string }>).filter(
      (row) => !(hostPresents && row.user_id === match.host_id),
    );

    return res.json({
      match: { ...match, questions: sanitizeQuestions(match, sub), question_count: questionCount(match) },
      participants: participantsRes.data ?? [],
      scoreboard,
      server_now: new Date().toISOString(),
    });
  } catch (err) {
    return caughtError('play/state', res, err);
  }
}

async function control(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  const sub = await requireAuthSub(req, res);
  if (!sub) return;
  if (!(await enforceRateLimit(req, res, RATE_LIMITS.playMutationPerUser, `user:${sub}`))) return;

  const body = (req.body || {}) as { code?: unknown; action?: unknown };
  if (!isShortString(body.code, 16)) return jsonError(res, 400, 'bad_request', 'code required');
  if (body.action !== 'start' && body.action !== 'advance' && body.action !== 'finish' && body.action !== 'reveal') {
    return jsonError(res, 400, 'bad_request', 'action must be start | advance | finish | reveal');
  }
  const ctrl = body.action as 'start' | 'advance' | 'finish' | 'reveal';
  const code = body.code.toUpperCase();

  try {
    const { data: match, error: matchError } = await withTimeout(
      supabase!
        .from('matches')
        .select('id, mode, host_id, status, current_index, questions')
        .eq('code', code)
        .in('subject', deploymentSubjectIds())
        .maybeSingle(),
    );
    if (matchError) return jsonError(res, 503, 'backend_unavailable', 'Match state is temporarily unavailable');

    if (!match) return jsonError(res, 404, 'not_found', 'Match not found');
    if (match.host_id !== sub)
      return jsonError(res, 403, 'forbidden', 'Only the host can do this');

    const patch: Record<string, unknown> = {};
    const now = new Date().toISOString();

    // "Reveal answer" closes the classroom question on screen: answer()
    // refuses it from now on, and the scoreboard counts it (056). Revealing
    // the same question again changes nothing.
    if (ctrl === 'reveal') {
      if (match.mode !== 'classroom') {
        return jsonError(res, 400, 'bad_request', 'Only a classroom question can be revealed');
      }
      if (match.status !== 'running') return jsonError(res, 409, 'bad_state', 'Match is not running');
      const current = match.current_index ?? 0;
      const { data: revealed, error: revealError } = await withTimeout(
        supabase!
          .from('matches')
          .update({ revealed_idx: current, last_heartbeat_at: now })
          .eq('id', match.id)
          .eq('status', 'running')
          .eq('current_index', current)
          .select('id'),
      );
      if (revealError) {
        logEvent('play/control', { status: 500, error: revealError.message, action: ctrl });
        return jsonError(res, 500, 'db_error', 'Could not update match');
      }
      if (!revealed || revealed.length === 0) {
        return jsonError(res, 409, 'stale_state', 'Match state changed; refresh and try again');
      }
      logEvent('play/control', { status: 200, code, action: ctrl });
      return res.json({ ok: true, status: 'running', current_index: current, revealed_idx: current });
    }

    if (ctrl === 'start') {
      if (match.status !== 'lobby')
        return jsonError(res, 409, 'bad_state', 'Match already started');
      patch.status = 'running';
      patch.current_index = 0;
      patch.started_at = now;
      patch.question_started_at = now;
      // question_duration_s is set at create time (incl. 0 = no limit), so we
      // intentionally leave it untouched here.
    } else if (ctrl === 'advance') {
      if (match.status !== 'running')
        return jsonError(res, 409, 'bad_state', 'Match is not running');
      // Same advance state machine as the auto-advance paths.
      const bumped = await tryAdvance(match);
      if (!bumped) {
        return jsonError(res, 409, 'stale_state', 'Match state changed; refresh and try again');
      }
      logEvent('play/control', { status: 200, code, action: ctrl });
      return res.json({ ok: true, status: bumped.status, current_index: bumped.current_index });
    } else {
      patch.status = 'finished';
      patch.ended_at = now;
    }
    patch.last_heartbeat_at = now;

    // Conditional update: only apply if the row is still in the state we read.
    // This prevents double-advance under concurrent host clicks/retries.
    const { data: updated, error } = await withTimeout(
      supabase!
        .from('matches')
        .update(patch)
        .eq('id', match.id)
        .eq('status', match.status)
        .eq('current_index', match.current_index ?? 0)
        .select('id'),
    );
    if (error) {
      logEvent('play/control', { status: 500, error: error.message, action: ctrl });
      return jsonError(res, 500, 'db_error', 'Could not update match');
    }
    if (!updated || updated.length === 0) {
      return jsonError(res, 409, 'stale_state', 'Match state changed; refresh and try again');
    }

    logEvent('play/control', { status: 200, code, action: ctrl });
    return res.json({ ok: true, ...patch });
  } catch (err) {
    return caughtError('play/control', res, err);
  }
}

async function answer(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  const sub = await requireAuthSub(req, res);
  if (!sub) return;
  if (!(await enforceRateLimit(req, res, RATE_LIMITS.playMutationPerUser, `user:${sub}`))) return;

  const body = (req.body || {}) as {
    code?: unknown;
    question_idx?: unknown;
    selected_idx?: unknown;
    duration_ms?: unknown;
    client_received_at?: unknown;
  };
  if (!isShortString(body.code, 16)) return jsonError(res, 400, 'bad_request', 'code required');
  if (typeof body.question_idx !== 'number' || !Number.isInteger(body.question_idx) || body.question_idx < 0)
    return jsonError(res, 400, 'bad_request', 'question_idx must be a non-negative integer');
  if (typeof body.selected_idx !== 'number' || !Number.isInteger(body.selected_idx) || body.selected_idx < 0 || body.selected_idx > 25)
    return jsonError(res, 400, 'bad_request', 'selected_idx out of range');

  const clientDuration =
    typeof body.duration_ms === 'number' && body.duration_ms >= 0 && body.duration_ms < 5 * 60 * 1000
      ? Math.round(body.duration_ms)
      : null;
  const clientReceivedAt =
    typeof body.client_received_at === 'string' && body.client_received_at.length <= 64
      ? new Date(body.client_received_at).getTime()
      : null;

  const code = body.code.toUpperCase();
  try {
    const { data: match, error: matchError } = await withTimeout(
      supabase!
        .from('matches')
        .select('id, mode, subject, host_id, status, current_index, questions, question_started_at, question_duration_s, revealed_idx')
        .eq('code', code)
        .in('subject', deploymentSubjectIds())
        .maybeSingle(),
    );
    // A failed read is no missing room: a 404 tells the player the room is gone.
    if (matchError) return jsonError(res, 503, 'backend_unavailable', 'Match state is temporarily unavailable');
    if (!match) return jsonError(res, 404, 'not_found', 'Match not found');
    if (match.status !== 'running' && match.status !== 'finished')
      return jsonError(res, 409, 'bad_state', 'Match is not in progress');
    if (body.question_idx > (match.current_index ?? 0))
      return jsonError(res, 409, 'wrong_question', 'That is not the current question');

    const matchQuestions = match.questions as MatchQuestion[];
    const q = matchQuestions[body.question_idx];
    if (!q) return jsonError(res, 400, 'bad_request', 'question_idx out of range');
    // An index past the question's options would be recorded as a wrong
    // answer and counted in the distribution as an option nobody was shown.
    if (!Array.isArray(q.options) || body.selected_idx >= q.options.length) {
      return jsonError(res, 400, 'bad_request', 'selected_idx out of range');
    }

    // A classroom host holds the answer key while the room runs; they present
    // and never compete.
    if (match.mode === 'classroom' && match.host_id === sub) {
      return jsonError(res, 403, 'host_cannot_answer', 'The classroom host presents and does not answer');
    }

    // Only players who joined the lobby may answer — otherwise anyone with
    // the code could inject rows that count toward the all-answered advance.
    // The caller's recorded answer is read beside the membership: the two
    // reads are independent, and a non-member's answer is never used.
    const [
      { data: participantRows, error: participantError },
      { data: existing, error: existingError },
    ] = await Promise.all([
      withTimeout(supabase!.from('match_participants').select('user_id').eq('match_id', match.id)),
      withTimeout(
        supabase!
          .from('match_answers')
          .select('is_correct, speed_bonus')
          .eq('match_id', match.id)
          .eq('user_id', sub)
          .eq('question_idx', body.question_idx)
          .maybeSingle(),
      ),
    ]);
    if (participantError) return jsonError(res, 503, 'backend_unavailable', 'Could not verify match membership');
    const participantIds = (participantRows ?? []).map((r: { user_id: string }) => r.user_id);
    if (!participantIds.includes(sub)) {
      return jsonError(res, 403, 'not_participant', 'Join the match before answering');
    }

    // A classroom pupil learns whether an answer scored when the question
    // closes, from the scoreboard state() serves (056). The answer itself is
    // only acknowledged, its retry included, so no pupil can tell the room
    // which option scores while the question is open. A multiplayer player
    // gets their own result at once, as before.
    const classroom = match.mode === 'classroom';
    const reply = (graded: { is_correct: boolean; speed_bonus: number }, advanced: boolean) =>
      classroom
        ? { ok: true, accepted: true, advanced: false }
        : { ok: true, is_correct: graded.is_correct, speed_bonus: graded.speed_bonus, advanced };

    // An answer is final. A duplicate submit (network retry, double click)
    // replays the recorded result instead of re-grading, so a player can't
    // keep swapping options after seeing is_correct.
    if (existingError) return jsonError(res, 503, 'backend_unavailable', 'Could not verify existing answer');
    if (existing) return res.json(reply(existing, false));

    // A response can be lost after the stored answer advances or finishes the
    // match. Replay it above, but never insert a new answer for a closed round.
    if (match.status !== 'running') return jsonError(res, 409, 'bad_state', 'Match is not in progress');
    if (body.question_idx !== match.current_index) return jsonError(res, 409, 'wrong_question', 'That is not the current question');

    const questionStartMs = match.question_started_at
      ? new Date(match.question_started_at).getTime()
      : null;

    // A classroom question the teacher revealed is closed (056). A retry of
    // an answer that landed before the reveal was replayed above.
    if (match.mode === 'classroom' && match.revealed_idx === body.question_idx) {
      return jsonError(res, 409, 'question_closed', 'The teacher closed this question');
    }

    // A timed question closes when its clock runs out, plus the grace the
    // expiry advance in state() allows an answer sent on the buzzer. A
    // classroom question stays current until the host moves on, and a
    // multiplayer one until someone reads the room, so the clock is checked
    // here rather than inferred from the current index. A retry of an answer
    // that landed in time was replayed above.
    if (pastAnswerWindow(match, Date.now())) {
      return jsonError(res, 409, 'time_up', 'Time ran out for this question');
    }

    let serverElapsedMs = 0;
    if (questionStartMs) {
      serverElapsedMs = Date.now() - questionStartMs;
      if (clientReceivedAt !== null && Number.isFinite(clientReceivedAt)) {
        const cappedReceived = Math.min(
          Math.max(clientReceivedAt, questionStartMs),
          questionStartMs + PING_GRACE_MS,
        );
        serverElapsedMs = Math.max(0, Date.now() - cappedReceived);
      }
    } else if (clientDuration !== null) {
      serverElapsedMs = clientDuration;
    }

    const { play: playSettings } = await getGameSettings();
    const isCorrect = q.correct_index === body.selected_idx;
    const durationS = match.question_duration_s ?? playSettings.defaultDurationS;
    const speedBonus = isCorrect
      ? computeSpeedBonus(serverElapsedMs, durationS, playSettings.maxSpeedBonus)
      : 0;

    // Insert-only makes the first answer final even when two tabs submit at
    // the same time. A unique-key conflict replays the recorded first answer.
    const { error } = await withTimeout(
      supabase!.from('match_answers').insert(
        {
          match_id: match.id,
          user_id: sub,
          question_id: q.id,
          question_idx: body.question_idx,
          selected_idx: body.selected_idx,
          is_correct: isCorrect,
          duration_ms: serverElapsedMs,
          speed_bonus: speedBonus,
        },
      ),
    );

    if (error) {
      if (error.code === '23505' || error.code === 'PT409') {
        // A second request may have stored this answer after our initial
        // read, even if the question closed before this insert (migration 074).
        const replay = await withTimeout(
          supabase!
            .from('match_answers')
            .select('is_correct, speed_bonus')
            .eq('match_id', match.id)
            .eq('user_id', sub)
            .eq('question_idx', body.question_idx)
            .maybeSingle(),
        );
        if (replay.error) return jsonError(res, 503, 'backend_unavailable', 'Could not verify existing answer');
        if (replay.data) return res.json(reply(replay.data, false));
      }
      if (error.code === 'PT409') {
        if (error.message === 'question_closed') return jsonError(res, 409, 'question_closed', 'The teacher closed this question');
        if (error.message === 'wrong_question') return jsonError(res, 409, 'wrong_question', 'That is not the current question');
        if (error.message === 'bad_state') return jsonError(res, 409, 'bad_state', 'Match is not in progress');
      }
      if (error.code === '55P03') return jsonError(res, 503, 'backend_unavailable', 'The match is updating. Try again.');
      logEvent('play/answer', { status: 500, error: error.message });
      return jsonError(res, 500, 'db_error', 'Could not record answer');
    }

    // In multiplayer everyone answers — the host competes like any other
    // player — so the match advances the moment the last participant locks
    // in (classroom keeps host-driven advance). The lazy checks in state()
    // (expiry; all-answered on no-limit matches) backstop this if two final
    // answers race past each other.
    let advanced = false;
    if (match.mode === 'multiplayer') {
      try {
        const { count: answeredCount, error: countError } = await withTimeout(
          supabase!
            .from('match_answers')
            .select('user_id', { count: 'exact', head: true })
            .eq('match_id', match.id)
            .eq('question_idx', body.question_idx),
        );
        if (countError) throw new Error(countError.message);
        if (participantIds.length > 0 && (answeredCount ?? 0) >= participantIds.length) {
          advanced = !!(await tryAdvance(match));
        }
      } catch (error) {
        // The answer already committed. The room's state reads can move it
        // forward, while this response still acknowledges the stored answer.
        logEvent('play/answer', { level: 'warn', code, reason: 'advance_unavailable', error: error instanceof Error ? error.message : 'unknown' });
      }
    }

    logEvent('play/answer', {
      status: 200,
      code,
      q: body.question_idx,
      ok: isCorrect,
      bonus: speedBonus,
      advanced,
    });
    return res.json(reply({ is_correct: isCorrect, speed_bonus: speedBonus }, advanced));
  } catch (err) {
    return caughtError('play/answer', res, err);
  }
}

async function distribution(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  const sub = await requireAuthSub(req, res);
  if (!sub) return;
  if (!(await enforceRateLimit(req, res, RATE_LIMITS.playDistributionPerUser, `user:${sub}`))) return;

  if (!isShortString(req.query.code, 16)) return jsonError(res, 400, 'bad_request', 'code required');
  const code = req.query.code.toUpperCase();
  const qParam = parseInt(req.query.q as string, 10);
  if (!Number.isFinite(qParam) || qParam < 0)
    return jsonError(res, 400, 'bad_request', 'q (question index) required');

  try {
    const { data: match, error: matchError } = await withTimeout(
      supabase!.from('matches').select('id, host_id, mode, status').eq('code', code).in('subject', deploymentSubjectIds()).maybeSingle(),
    );

    if (matchError) return jsonError(res, 503, 'backend_unavailable', 'Match state is temporarily unavailable');
    if (!match) return jsonError(res, 404, 'not_found', 'Match not found');
    if (sub !== match.host_id) {
      return jsonError(res, 403, 'forbidden', 'Only the host can view distribution');
    }
    // The buckets carry per-option counts and which option is correct. A
    // multiplayer host is a competitor, so they read them only after the end.
    if (match.mode !== 'classroom' && match.status !== 'finished') {
      return jsonError(res, 403, 'forbidden', 'The answer distribution opens when the match ends');
    }

    const { data, error } = await withTimeout(
      supabase!.rpc('match_question_distribution', {
        p_match_id: match.id,
        p_question_idx: qParam,
      }),
    );

    if (error) {
      if (isRpcMissing(error)) {
        return jsonError(res, 503, 'rpc_missing', 'Run supabase/supabase-schema-005.sql');
      }
      return jsonError(res, 500, 'db_error', 'Could not load distribution');
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.json({ buckets: data ?? [] });
  } catch (err) {
    return caughtError('play/distribution', res, err);
  }
}

async function heartbeat(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  const sub = await requireAuthSub(req, res);
  if (!sub) return;
  if (!(await enforceRateLimit(req, res, RATE_LIMITS.playMutationPerUser, `user:${sub}`))) return;

  const body = (req.body || {}) as { code?: unknown };
  if (!isShortString(body.code, 16)) return jsonError(res, 400, 'bad_request', 'code required');

  const code = body.code.toUpperCase();
  try {
    const { data: match, error: matchError } = await withTimeout(
      supabase!.from('matches').select('id, host_id, status').eq('code', code).in('subject', deploymentSubjectIds()).maybeSingle(),
    );
    if (matchError) return jsonError(res, 503, 'backend_unavailable', 'Match state is temporarily unavailable');
    if (!match) return jsonError(res, 404, 'not_found', 'Match not found');
    if (match.host_id !== sub)
      return jsonError(res, 403, 'forbidden', 'Only the host can send heartbeats');
    if (match.status !== 'running' && match.status !== 'lobby')
      return jsonError(res, 409, 'bad_state', 'Match is not active');

    const { error } = await withTimeout(
      supabase!
        .from('matches')
        .update({ last_heartbeat_at: new Date().toISOString() })
        .eq('id', match.id),
    );

    if (error) {
      logEvent('play/heartbeat', { status: 500, error: error.message });
      return jsonError(res, 500, 'db_error', 'Could not record heartbeat');
    }

    return res.json({ ok: true });
  } catch (err) {
    return caughtError('play/heartbeat', res, err);
  }
}
