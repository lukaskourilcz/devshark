import type { VercelRequest, VercelResponse } from './vercel-types.js';
import { jsonError, tryAuthOnce } from './http';
import { AuthError, confirmedEmail } from './auth';

const ADMIN_EMAILS = new Set(
  `${process.env.ADMIN_EMAILS ?? ''},${process.env.OWNER_EMAIL ?? ''}`
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);
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

/** Verify the Supabase admin identity once per request, including a rate-limit
 * check that already verified it. A service failure retains its retryable
 * response; missing credentials and accounts without an admin role get 403. */
export async function requireAdmin(req: VercelRequest, res: VercelResponse): Promise<boolean> {
  try {
    const auth = await tryAuthOnce(req);
    if (auth && hasAdminRole(auth.payload)) {
      verifiedAdmins.set(req, auth.sub);
      return true;
    }
  } catch (error) {
    if (!(error instanceof AuthError)) {
      jsonError(res, 503, 'auth_unavailable', 'Authentication service is unavailable');
      return false;
    }
    if (error.status >= 500) {
      jsonError(res, error.status, error.code, error.message);
      return false;
    }
  }
  jsonError(res, 403, 'forbidden', 'Administrative access required');
  return false;
}

/** The verified account for a request that passed the admin gate. */
export function adminSubject(req: VercelRequest): string | null {
  return verifiedAdmins.get(req) ?? null;
}
