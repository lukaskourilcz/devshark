// Admin gate for the /dev endpoints. Verified Supabase identities are the
// primary production path; the legacy shared password is opt-in only.
//
// Production posture is identity-first and fail-closed: requireAuth verifies
// the Supabase user, and authorization trusts only app_metadata or the
// server-side email allow-list. The old shared password exists only as an
// explicitly enabled migration fallback; local development retains its
// historical convenience value.

import type { VercelRequest, VercelResponse } from './vercel-types.js';
import { timingSafeEqual } from 'node:crypto';
import { jsonError, tryAuthOnce } from './http';
import { AuthError, confirmedEmail } from './auth';

const IS_PROD = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
const RAW_DEV_PASSWORD = process.env.DEV_PASSWORD;
const ALLOW_LEGACY_PASSWORD = !IS_PROD || process.env.ALLOW_LEGACY_DEV_PASSWORD === 'true';
const ADMIN_EMAILS = new Set(
  `${process.env.ADMIN_EMAILS ?? ''},${process.env.OWNER_EMAIL ?? ''}`
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);
// Sentinel that no supplied password can match (128 random-looking chars).
const DEV_PASSWORD =
  RAW_DEV_PASSWORD && RAW_DEV_PASSWORD.length > 0
    ? RAW_DEV_PASSWORD
    : IS_PROD
      ? '__admin_disabled__' + Math.random().toString(36).repeat(20)
      : 'autobus';
const ADMIN_DISABLED_IN_PROD = IS_PROD && (!RAW_DEV_PASSWORD || RAW_DEV_PASSWORD.length === 0);
if (ADMIN_DISABLED_IN_PROD) {
  console.warn('[admin-auth] DEV_PASSWORD is not set in production; legacy password access is disabled');
}

function constantTimeEquals(a: string, b: string): boolean {
  const ab = new Uint8Array(Buffer.from(a, 'utf8'));
  const bb = new Uint8Array(Buffer.from(b, 'utf8'));
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function suppliedPassword(req: VercelRequest): string {
  const header = req.headers['x-dev-password'];
  if (typeof header === 'string') return header;
  if (Array.isArray(header)) return header[0] ?? '';
  const body = (req.body || {}) as { password?: unknown };
  return typeof body.password === 'string' ? body.password : '';
}

/** Legacy password check. New production deployments should not call it. */
function requireDevPassword(req: VercelRequest, res: VercelResponse): boolean {
  if (ADMIN_DISABLED_IN_PROD) {
    jsonError(res, 503, 'admin_disabled', 'Admin API is disabled');
    return false;
  }
  if (constantTimeEquals(suppliedPassword(req), DEV_PASSWORD)) return true;
  jsonError(res, 401, 'unauthorized', 'Invalid dev password');
  return false;
}

function hasAdminRole(payload: Record<string, unknown>): boolean {
  const app = (payload.app_metadata ?? {}) as Record<string, unknown>;
  if (app.admin === true || app.is_admin === true || app.role === 'admin') return true;
  if (Array.isArray(app.roles) && app.roles.includes('admin')) return true;
  // The allow-list names addresses, so only a confirmed one counts.
  const email = confirmedEmail(payload)?.toLowerCase() ?? '';
  return !!email && ADMIN_EMAILS.has(email);
}

/** The admin account each request passed `requireAdmin` with. */
const verifiedAdmins = new WeakMap<VercelRequest, string>();

/** Verify a Supabase admin identity, with an explicitly enabled legacy-password
 * fallback for controlled migrations. Authorization never trusts user_metadata.
 *
 * A missing or refused session may still use the legacy gate. Supabase Auth
 * that could not decide (its 503 or 504) refused nobody: the admin is told the
 * sign-in service is down instead of 403 "not an admin", unless they sent the
 * legacy password, which needs no Auth. */
export async function requireAdmin(req: VercelRequest, res: VercelResponse): Promise<boolean> {
  let undecided: AuthError | null = null;
  try {
    // Verified once per request: a write's rate limit may have asked already.
    const auth = await tryAuthOnce(req);
    if (auth && hasAdminRole(auth.payload)) {
      verifiedAdmins.set(req, auth.sub);
      return true;
    }
  } catch (error) {
    if (!(error instanceof AuthError)) undecided = new AuthError(503, 'auth_unavailable', 'Authentication service is unavailable');
    else if (error.status >= 500) undecided = error;
  }

  const legacy = ALLOW_LEGACY_PASSWORD && Boolean(RAW_DEV_PASSWORD);
  if (legacy && (!undecided || suppliedPassword(req) !== '')) return requireDevPassword(req, res);
  if (undecided) {
    jsonError(res, undecided.status, undecided.code, undecided.message);
    return false;
  }
  jsonError(res, 403, 'forbidden', 'Administrative access required');
  return false;
}

/** The verified account that passed `requireAdmin` for this request, or null
 * when the legacy password did (it names nobody). Recorded with what the admin
 * creates, such as a Premium voucher's `created_by`. */
export function adminSubject(req: VercelRequest): string | null {
  return verifiedAdmins.get(req) ?? null;
}
