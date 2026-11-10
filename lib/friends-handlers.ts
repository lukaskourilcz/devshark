/** Friends operations on `api/user/[op].ts`: claim a handle, look one up, ask,
 * answer, remove, and read the list.
 *
 * The privacy decision is the whole design and it lives in migration 033, not
 * here. This product has never had a user directory, and it still does not:
 * a handle is opt-in, matching is exact equality on its lower-cased form, and
 * an account without a handle cannot be reached at all. There is no listing,
 * no prefix search and no suggestion. The handle is the learner's sharkname
 * (shared/sharkname.ts rolls one on the Profile). `user_stats.name` and
 * `.picture` are what Google supplied; friends see them only after the
 * learner chose so with op=identity (migration 055), and `.email` is read by
 * nothing on this path.
 *
 * Every routine below is service-role only and reached exactly once, after the
 * caller's own token has been verified. A friend's numbers are assembled by the
 * database, scoped to this deployment's own categories, and never assembled
 * from anything the browser sent.
 */

import type { VercelRequest, VercelResponse } from './vercel-types.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { jsonError, requireAuthResult, requireAuthSub, withTimeout, createLogger, ServiceUnavailableError } from './http';
import type { AuthResult } from './auth';
import { defaultDeploymentCategories } from './product-scope';
import { isValidHandle } from '../shared/handles';
import { camelSharkBase, isAllowedSharkBase } from '../shared/sharkname';
import { allocateSharkName } from './shark-name';

const logEvent = createLogger('friends');

/** Errors the routines raise on purpose, mapped to a status and a message the
 * learner can act on. Anything not listed here is a 500: an unexpected
 * database error must not be reported as a user mistake. */
const KNOWN: Record<string, { status: number; code: string; message: string }> = {
  invalid_handle: { status: 400, code: 'invalid_handle', message: 'Choose a generated sharkname. Its number is added automatically.' },
  handle_taken: { status: 409, code: 'handle_taken', message: 'That sharkname is already taken' },
  handle_cooldown: { status: 409, code: 'handle_cooldown', message: 'A sharkname can be changed once every 30 days' },
  handle_not_found: { status: 404, code: 'not_found', message: 'No account with that sharkname' },
  cannot_friend_self: { status: 400, code: 'bad_request', message: 'That is your own sharkname' },
  friend_limit_reached: { status: 409, code: 'friend_limit', message: 'You have reached the friend limit' },
  pending_limit_reached: { status: 409, code: 'pending_limit', message: 'You have too many requests waiting for an answer' },
  request_declined: { status: 409, code: 'declined', message: 'That request was declined' },
  no_request: { status: 404, code: 'not_found', message: 'There is no request to answer' },
  invalid_country: { status: 400, code: 'invalid_country', message: 'A country is a two-letter ISO code, or blank for none' },
  no_handle: { status: 409, code: 'no_handle', message: 'Choose a sharkname first' },
};

function rpcError(res: VercelResponse, error: { code?: string; message?: string } | null, fallback: string, migration = '033') {
  // A sharkname allocation that timed out (lib/http.ts) is the database busy
  // for a moment, which the client may retry: 503, never a 500.
  if (error instanceof ServiceUnavailableError) return jsonError(res, 503, error.code, error.message);
  if (error?.code === '55P03') return jsonError(res, 503, 'friendship_busy', 'A friendship update is in progress. Try again in a moment.');
  const raised = Object.keys(KNOWN).find((key) => error?.message?.includes(key));
  if (raised) {
    const known = KNOWN[raised];
    return jsonError(res, known.status, known.code, known.message);
  }
  if (/does not exist|schema cache/i.test(error?.message ?? '')) {
    return jsonError(res, 503, 'migration_required', `Run supabase/supabase-schema-${migration}.sql to enable friends`);
  }
  logEvent({ status: 500, error: error?.message ?? 'unknown' });
  return jsonError(res, 500, 'db_error', fallback);
}

const readHandle = (value: unknown): string | null => {
  const handle = typeof value === 'string' ? value.trim() : '';
  return isValidHandle(handle) ? handle : null;
};

export async function handleFriends(
  op: string,
  req: VercelRequest,
  res: VercelResponse,
  supabase: SupabaseClient,
) {
  const userId = await requireAuthSub(req, res);
  if (!userId) return;

  // Nothing here is cacheable: every response is one person's own view of
  // their own relationships.
  res.setHeader('Cache-Control', 'private, no-store');

  const body = (req.body || {}) as Record<string, unknown>;

  // ── the caller's own handle ────────────────────────────────────────────
  if (op === 'friends-handle') {
    if (req.method === 'GET') {
      let { data, error } = await withTimeout(supabase.rpc('get_user_handle', { p_user_id: userId }));
      if (error) return rpcError(res, error, 'Could not read your handle');
      let row = Array.isArray(data) ? data[0] : data;
      if (!row?.handle) {
        try { await allocateSharkName(supabase, { userId }); }
        catch (error) { return rpcError(res, error as Error, 'Could not create your sharkname', '063'); }
        const read = await withTimeout(supabase.rpc('get_user_handle', { p_user_id: userId }));
        if (read.error) return rpcError(res, read.error, 'Could not read your handle');
        row = Array.isArray(read.data) ? read.data[0] : read.data;
      }
      return res.json({
        handle: row?.handle ?? null,
        ordinal: typeof row?.ordinal === 'string' ? row.ordinal : null,
        base: row?.base ?? null,
        discoverable: row?.discoverable ?? true,
        country: row?.country ?? null,
        canChangeAt: row?.can_change_at ?? null,
      });
    }
    if (req.method === 'PUT') {
      // Three independent settings on one op: the handle itself, whether a
      // stranger who types it can find you, and the flag shown beside your
      // avatar. Each is recognised by its own key being present, so saving one
      // never silently rewrites another.
      if (typeof body.discoverable === 'boolean' && body.handle === undefined && body.base === undefined) {
        const { data, error } = await withTimeout(
          supabase.rpc('set_handle_discoverable', { p_user_id: userId, p_discoverable: body.discoverable }),
        );
        if (error) return rpcError(res, error, 'Could not save the setting');
        return res.json({ discoverable: data === true });
      }
      if (body.country !== undefined && body.handle === undefined && body.base === undefined) {
        // '' and null both mean "no flag". Anything else has to be two letters,
        // and the database refuses it again if this misses.
        const raw = body.country;
        if (raw !== null && typeof raw !== 'string') {
          return jsonError(res, 400, 'invalid_country', KNOWN.invalid_country.message);
        }
        const country = raw === null ? '' : raw.trim().toUpperCase();
        if (country !== '' && !/^[A-Z]{2}$/.test(country)) {
          return jsonError(res, 400, 'invalid_country', KNOWN.invalid_country.message);
        }
        const { data, error } = await withTimeout(
          supabase.rpc('set_user_country', { p_user_id: userId, p_country: country }),
        );
        if (error) return rpcError(res, error, 'Could not save your country');
        return res.json({ country: (data as string | null) ?? null });
      }
      const raw = body.base ?? body.handle;
      const base = typeof raw === 'string' && isValidHandle(raw.trim())
        ? body.base !== undefined ? raw.trim() : camelSharkBase(raw.trim()) : '';
      if (!isAllowedSharkBase(base)) return jsonError(res, 400, 'invalid_handle', KNOWN.invalid_handle.message);
      let allocation;
      try { allocation = await allocateSharkName(supabase, { userId, base, replace: true }); }
      catch (error) { return rpcError(res, error as Error, 'Could not save your handle', '063'); }
      logEvent({ status: 200, op: 'handle_set' });
      return res.json(allocation);
    }
    res.setHeader('Allow', 'GET, PUT');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }

  // ── looking somebody up ────────────────────────────────────────────────
  // One handle in, at most one row out, carrying a handle, a relationship
  // state and the name to show. No account id, no picture, no crown, no
  // statistic, and for anyone but an accepted friend the name is the handle
  // itself: a stranger learns only what the other person published by
  // claiming it.
  if (op === 'friends-lookup') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
    }
    const handle = readHandle(req.query.handle);
    if (!handle) return res.json({ found: false });
    const { data, error } = await withTimeout(
      supabase.rpc('friend_lookup', { p_user_id: userId, p_handle: handle }),
    );
    if (error) return rpcError(res, error, 'Could not search');
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return res.json({ found: false });
    return res.json({ found: true, handle: row.handle, state: row.state, displayName: row.display_name ?? row.handle });
  }

  // ── asking, answering, removing ────────────────────────────────────────
  if (op === 'friends-request' || op === 'friends-respond' || op === 'friends-remove') {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
    }
    const handle = readHandle(body.handle);
    if (!handle) return jsonError(res, 400, 'invalid_handle', KNOWN.invalid_handle.message);
    // Answering and blocking are decisions, so they are read only from a real
    // true or false: an `accept` of "yes" used to decline the request.
    if (op === 'friends-respond' && typeof body.accept !== 'boolean') {
      return jsonError(res, 400, 'bad_request', 'accept must be true or false');
    }
    if (op === 'friends-remove' && body.block !== undefined && typeof body.block !== 'boolean') {
      return jsonError(res, 400, 'bad_request', 'block must be true or false');
    }

    if (op === 'friends-request') {
      const { data, error } = await withTimeout(
        supabase.rpc('request_friend', { p_user_id: userId, p_handle: handle }),
      );
      if (error) return rpcError(res, error, 'Could not send the request');
      logEvent({ status: 200, op: 'request', state: String(data) });
      // A newly recorded request, a retry, and a request muted by a block
      // have the same outward state for the sender. The recipient does not
      // see a muted request.
      return res.json({ state: data === 'pending' ? 'pending_out' : data });
    }

    if (op === 'friends-respond') {
      const { data, error } = await withTimeout(
        supabase.rpc('respond_friend', { p_user_id: userId, p_handle: handle, p_accept: body.accept === true }),
      );
      if (error) return rpcError(res, error, 'Could not answer the request');
      logEvent({ status: 200, op: 'respond', state: String(data) });
      return res.json({ state: data });
    }

    const { data, error } = await withTimeout(
      supabase.rpc('remove_friend', { p_user_id: userId, p_handle: handle, p_block: body.block === true }),
    );
    if (error) return rpcError(res, error, 'Could not remove');
    logEvent({ status: 200, op: 'remove', blocked: body.block === true });
    return res.json({ removed: data === true });
  }

  // ── the list ───────────────────────────────────────────────────────────
  if (op === 'friends-list') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
    }
    // The categories are this deployment's own, never the browser's, so a
    // friend list sums webdev activity only.
    const categories = defaultDeploymentCategories();
    const [list, requests] = await Promise.all([
      withTimeout(supabase.rpc('friend_list', { p_user_id: userId, p_categories: categories })),
      withTimeout(supabase.rpc('friend_requests', { p_user_id: userId })),
    ]);
    if (list.error) return rpcError(res, list.error, 'Could not load your friends');
    if (requests.error) return rpcError(res, requests.error, 'Could not load your requests');
    return res.json({
      // display_name and the gated picture arrive with migration 055; before
      // it the handle is the name and the picture is the old ungated one.
      friends: (list.data ?? []).map((row: Record<string, unknown>) => ({
        handle: row.handle,
        displayName: row.display_name ?? row.handle,
        picture: row.picture ?? null,
        country: row.country ?? null,
        crown: row.crown === true,
        currentStreak: Number(row.current_streak ?? 0),
        longestStreak: Number(row.longest_streak ?? 0),
        totalCorrect: Number(row.total_correct ?? 0),
        totalQuestions: Number(row.total_questions ?? 0),
        accuracyPct: Number(row.accuracy_pct ?? 0),
        activeToday: row.active_today === true,
      })),
      requests: (requests.data ?? []).map((row: Record<string, unknown>) => ({
        handle: row.handle,
        displayName: row.display_name ?? row.handle,
        direction: row.direction,
      })),
    });
  }

  return jsonError(res, 404, 'unknown_op', `Unknown friends op: ${op}`);
}

/** The name and photo Google gave the account, as api/user/[op].ts reads them
 * (verifiedProfile): null for an email/password account. */
export type VerifiedProfile = (auth: AuthResult) => Promise<{ name: string | null; picture: string | null }>;

/**
 * op=identity on `api/user/[op].ts`: what friends see of the caller
 * (migration 055). GET answers
 * `{ showRealName, showPhoto, realName, photo }`; PUT takes
 * `{ showRealName?: boolean, showPhoto?: boolean }`, at least one, and
 * answers the same. `realName` and `photo` are the caller's own Google name
 * and photo, so the Profile offers "your name" only to an account that has
 * one. Switching either on is refused (409) when there is nothing to show,
 * and first copies the verified name and photo into user_stats, which is
 * where friend_list and the boards read them. The route's write limit
 * (limitUserWrite) charges each PUT to the account.
 */
export async function handleIdentity(
  req: VercelRequest,
  res: VercelResponse,
  supabase: SupabaseClient | null,
  profileOf: VerifiedProfile,
) {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.setHeader('Allow', 'GET, PUT');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  const auth = await requireAuthResult(req, res);
  if (!auth) return;
  if (!supabase) return jsonError(res, 503, 'not_configured', 'Backend is not configured');
  res.setHeader('Cache-Control', 'private, no-store');

  let showRealName: boolean | null = null;
  let showPhoto: boolean | null = null;
  if (req.method === 'PUT') {
    const body = req.body as Record<string, unknown> | null | undefined;
    const valid = !!body && typeof body === 'object' && !Array.isArray(body)
      && (body.showRealName === undefined || typeof body.showRealName === 'boolean')
      && (body.showPhoto === undefined || typeof body.showPhoto === 'boolean')
      && (body.showRealName !== undefined || body.showPhoto !== undefined);
    if (!valid || !body) return jsonError(res, 400, 'bad_request', 'showRealName and showPhoto must be true or false');
    showRealName = typeof body.showRealName === 'boolean' ? body.showRealName : null;
    showPhoto = typeof body.showPhoto === 'boolean' ? body.showPhoto : null;
  }

  try {
    const profile = await profileOf(auth);
    const answer = (row: { show_real_name?: unknown; show_photo_to_friends?: unknown } | null | undefined) => res.json({
      showRealName: row?.show_real_name === true,
      showPhoto: row?.show_photo_to_friends === true,
      realName: profile.name,
      photo: profile.picture,
    });

    if (req.method === 'GET') {
      const { data, error } = await withTimeout(
        supabase.from('user_handles').select('show_real_name, show_photo_to_friends').eq('user_id', auth.sub).maybeSingle(),
      );
      if (error) {
        // 42703: the columns are missing, so migration 055 is not applied yet.
        if (error.code === '42703') return jsonError(res, 503, 'migration_required', 'Run supabase/supabase-schema-055.sql to enable this setting');
        logEvent({ status: 500, op: 'identity', reason: 'select_failed', error: error.message });
        return jsonError(res, 500, 'db_error', 'Could not load what friends see');
      }
      return answer(data as { show_real_name?: unknown; show_photo_to_friends?: unknown } | null);
    }

    if (showRealName === true && !profile.name) {
      return jsonError(res, 409, 'no_real_name', 'Your account has no Google name to show');
    }
    if (showPhoto === true && !profile.picture) {
      return jsonError(res, 409, 'no_photo', 'Your account has no Google photo to show');
    }
    if (showRealName === true || showPhoto === true) {
      const stats = await withTimeout(
        supabase.from('user_stats').upsert(
          { user_id: auth.sub, name: profile.name, picture: profile.picture },
          { onConflict: 'user_id' },
        ),
      );
      if (stats.error) {
        logEvent({ status: 500, op: 'identity', reason: 'stats_failed', error: stats.error.message });
        return jsonError(res, 500, 'db_error', 'Could not save what friends see');
      }
    }
    const { data, error } = await withTimeout(
      supabase.rpc('set_friend_display', { p_user_id: auth.sub, p_show_real_name: showRealName, p_show_photo: showPhoto }),
    );
    if (error) return rpcError(res, error, 'Could not save what friends see', '055');
    logEvent({ status: 200, op: 'identity', showRealName, showPhoto });
    return answer(Array.isArray(data) ? data[0] : data);
  } catch (err) {
    const timedOut = err instanceof ServiceUnavailableError;
    logEvent({ status: timedOut ? 503 : 500, op: 'identity', reason: 'exception', error: err instanceof Error ? err.message : 'unknown' });
    if (timedOut) return jsonError(res, 503, err.code, err.message);
    return jsonError(res, 500, 'internal_error', 'Internal error');
  }
}
