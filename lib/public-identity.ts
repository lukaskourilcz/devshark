import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthResult } from './auth';
import { withTimeout } from './http';

// The name and picture other people may see for an account, worked out on the
// server from the verified sign-in and never from a request body.
//
// A board row and a live room show what is here. The name comes from the
// account's Google identity; the picture only when Google serves it (the host
// the client already requires), so nothing loads an image from anywhere else.
// The name loses control and text-direction characters and is cut to a length
// a row can show. No email ever stands in for a missing name: an account made
// with an email and password has none, and a board says "Learner" while a
// room uses its sharkname.

const PUBLIC_NAME_MAX = 60;
const HIDDEN_NAME_CHARS = /[\p{Cc}‎‏‪-‮⁦-⁩]/gu;

export function publicName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = Array.from(value.replace(HIDDEN_NAME_CHARS, '').trim())
    .slice(0, PUBLIC_NAME_MAX)
    .join('')
    .trim();
  return clean || null;
}

function publicPicture(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const google = host === 'googleusercontent.com' || host.endsWith('.googleusercontent.com');
    return url.protocol === 'https:' && google ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The name and picture Google gave the account. Never `user_metadata`: any
 * signed-in user can rewrite that from the browser (`supabase.auth.updateUser`),
 * and a board would show whatever they wrote. The Google identity's data is
 * written by the sign-in alone. The verified user carries its identities; when
 * it does not, the admin API is asked. No Google identity, no name. */
export async function verifiedProfile(auth: AuthResult, db: SupabaseClient | null): Promise<{ name: string | null; picture: string | null }> {
  let identities: unknown = auth.payload.identities;
  if (!Array.isArray(identities) && db) {
    const fetched = await withTimeout(db.auth.admin.getUserById(auth.sub)).catch(() => null);
    identities = fetched && !fetched.error ? fetched.data.user?.identities : undefined;
  }
  const google = Array.isArray(identities)
    ? (identities as { provider?: unknown; identity_data?: unknown }[]).find((identity) => identity?.provider === 'google')
    : undefined;
  const data = (google?.identity_data && typeof google.identity_data === 'object'
    ? google.identity_data
    : {}) as Record<string, unknown>;
  return {
    name: publicName(data.full_name || data.name),
    picture: publicPicture(data.avatar_url || data.picture),
  };
}

/** "Player" and four digits taken from the account id: the same number in
 * every room, and nothing anyone typed or anything from the address. */
function playerNumberName(sub: string): string {
  const hex = sub.replace(/[^0-9a-f]/gi, '').slice(0, 8);
  const number = 1000 + ((hex ? parseInt(hex, 16) : 0) % 9000);
  return `Player ${number}`;
}

/**
 * The name a live room (Play, a classroom) shows for a signed-in player or
 * host: the account's Google name, else its sharkname (`user_handles.handle`),
 * else "Player" and a number. The name a client sends is not used: it used to
 * be the part of the address before the @ for every account without a Google
 * name, and anyone with the room code saw it.
 */
export async function roomDisplayName(auth: AuthResult, db: SupabaseClient | null): Promise<string> {
  const { name } = await verifiedProfile(auth, db);
  if (name) return name;
  if (db) {
    const handle = await withTimeout(
      db.from('user_handles').select('handle').eq('user_id', auth.sub).limit(1),
    ).catch(() => null);
    const row = handle && !handle.error && Array.isArray(handle.data) ? handle.data[0] as { handle?: unknown } | undefined : undefined;
    const sharkname = publicName(row?.handle);
    if (sharkname) return sharkname;
  }
  return playerNumberName(auth.sub);
}
