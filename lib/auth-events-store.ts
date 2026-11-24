// Auth events log (registrations + logins) for the /dev console "Logs" tab.
//
// The client reports a sign-in after Supabase confirms it; the server verifies
// the token and calls recordAuthEvent with the verified user id. The first event
// a user ever produces is a 'register', subsequent ones are 'login'. A short
// dedupe window collapses the duplicate SIGNED_IN events supabase-js can emit
// (multiple tabs, token refreshes) into a single row. Everything is best-effort:
// if the table is missing (pre-migration) or the DB is briefly unavailable, the
// log simply doesn't record rather than breaking sign-in.

import { createServiceClient, withTimeout } from './http';

const supabase = createServiceClient();
const TABLE = 'auth_events';
// Ignore repeat sign-in pings for the same user within this window.
const DEDUPE_MS = 2 * 60 * 1000;

type AuthEventType = 'register' | 'login';

export interface AuthEventRow {
  id: string;
  user_id: string;
  email: string | null;
  provider: string | null;
  event_type: AuthEventType;
  created_at: string;
}

export type RecordResult = AuthEventType | 'skipped' | 'unavailable';

/** Record a sign-in. Returns what was logged (or why it wasn't). Never throws. */
export async function recordAuthEvent(input: {
  userId: string;
  email: string | null;
  provider: string | null;
}): Promise<RecordResult> {
  if (!supabase) return 'unavailable';
  try {
    const { data, error } = await withTimeout(
      supabase
        .from(TABLE)
        .select('event_type, created_at')
        .eq('user_id', input.userId)
        .order('created_at', { ascending: false })
        .limit(1),
      4000,
    );
    // Missing table (pre-migration) or transient error — record nothing.
    if (error) return 'unavailable';

    const last = (data ?? [])[0] as { event_type: AuthEventType; created_at: string } | undefined;
    let kind: AuthEventType;
    if (!last) {
      kind = 'register';
    } else {
      const age = Date.now() - new Date(last.created_at).getTime();
      if (Number.isFinite(age) && age < DEDUPE_MS) return 'skipped';
      kind = 'login';
    }

    const { error: insErr } = await withTimeout(
      supabase.from(TABLE).insert({
        user_id: input.userId,
        email: input.email,
        provider: input.provider,
        event_type: kind,
      }),
      4000,
    );
    if (insErr) return 'unavailable';
    return kind;
  } catch {
    return 'unavailable';
  }
}

/** The table is not there yet (the migration that adds it has not run). */
function tableMissing(error: { code?: string; message?: string }): boolean {
  if (error.code === 'PGRST205' || error.code === '42P01') return true;
  return /could not find the table|relation .* does not exist/i.test(error.message ?? '');
}

/** Most recent auth events, newest first. [] when there is no log to read: no
 * Supabase configured, or the table not created yet. A read that fails or
 * times out throws, so the /dev Logs tab shows an error with Retry instead of
 * an empty log that looks like nobody signed in. */
export async function listAuthEvents(limit = 200): Promise<AuthEventRow[]> {
  if (!supabase) return [];
  const capped = Math.min(Math.max(Math.round(limit) || 0, 1), 500);
  const { data, error } = await withTimeout(
    supabase.from(TABLE).select('*').order('created_at', { ascending: false }).limit(capped),
    5000,
  );
  if (error) {
    if (tableMissing(error)) return [];
    throw new Error(`auth_events read failed: ${error.code ?? 'unknown'}`);
  }
  return (data ?? []) as AuthEventRow[];
}
