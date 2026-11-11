import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '../../lib/vercel-types';
import { handleAdminUsers, handleAdminEmails } from '../../lib/admin-directory';

const request = (method = 'GET', query: Record<string, unknown> = {}) => ({ method, query }) as VercelRequest;
function response() {
  const result = { statusCode: 200, body: null as unknown, headers: {} as Record<string, unknown>,
    setHeader(name: string, value: unknown) { this.headers[name] = value; return this; },
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; } };
  return result;
}
const fixture = (historyError: unknown = null) => {
  const user = { id: 'user-1', email: 'learner@example.invalid', email_confirmed_at: '2026-11-01',
    created_at: '2026-11-01', last_sign_in_at: '2026-11-10', user_metadata: { full_name: 'Learner', private: 'DO-NOT-RETURN' },
    app_metadata: { providers: ['google'], private: 'DO-NOT-RETURN' }, identities: [{ secret: 'DO-NOT-RETURN' }] };
  const history = [{ user_id: user.id, redeemed_at: '2026-11-11', voucher: { id: 'voucher-1', code_hint: 'AROL', note: 'Community' }, grant: { valid_until: '2027-02-09', status: 'active' } }];
  const chain = { select: vi.fn(() => chain), in: vi.fn(() => chain), order: vi.fn(() => chain), limit: vi.fn(async () => ({ data: history, count: 1001, error: historyError })) };
  const db = { auth: { admin: { listUsers: vi.fn(async () => ({ data: { users: [user], total: 30 }, error: null })) } },
    from: vi.fn(() => chain), rpc: vi.fn(async () => ({ data: { premium: true, source: 'promo', validUntil: '2027-02-09T00:00:00Z' }, error: null })) };
  return { db: db as unknown as SupabaseClient, raw: db, chain };
};
describe('admin directory data boundary', () => {
  it('returns bounded users with canonical Premium and redemptions, excluding Auth secrets', async () => {
    const { db, raw, chain } = fixture(); const res = response();
    await handleAdminUsers(request('GET', { page: '2' }), res as unknown as VercelResponse, db);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('private, no-store');
    expect(raw.auth.admin.listUsers).toHaveBeenCalledWith({ page: 2, perPage: 25 });
    expect(chain.in).toHaveBeenCalledWith('user_id', ['user-1']);
    expect(raw.rpc).toHaveBeenCalledWith('entitlement_summary', { p_user: 'user-1' });
    expect(res.body).toMatchObject({ page: 2, total: 30, hasNextPage: false, voucherHistoryPartial: true,
      users: [{ plan: { tier: 'premium', validUntil: '2027-02-09T00:00:00.000Z' }, vouchers: [{ hint: 'AROL', validUntil: '2027-02-09' }] }] });
    expect(JSON.stringify(res.body)).not.toMatch(/DO-NOT-RETURN|identities|code_hash|app_metadata|user_metadata/);
  });
  it('rejects invalid pagination and methods before reading accounts; errors never look like an empty directory', async () => {
    const { db, raw } = fixture();
    for (const page of ['0', '-1', '2x', ['1'], '1000000']) {
      const res = response(); await handleAdminUsers(request('GET', { page }), res as unknown as VercelResponse, db);
      expect(res.statusCode).toBe(400);
    }
    const wrong = response(); await handleAdminUsers(request('POST'), wrong as unknown as VercelResponse, db);
    expect(wrong.statusCode).toBe(405); expect(raw.auth.admin.listUsers).not.toHaveBeenCalled();
    const failed = fixture({ message: 'private internal details' }); const res = response();
    await handleAdminUsers(request(), res as unknown as VercelResponse, failed.db);
    expect(res.statusCode).toBe(503); expect(JSON.stringify(res.body)).not.toContain('private internal details');
  });
  it('previews real email text without sending messages or exposing provider credentials', async () => {
    vi.stubEnv('RESEND_API_KEY', 'DO-NOT-RETURN'); vi.stubEnv('SUPABASE_URL', 'https://exampleproject.supabase.co');
    try {
      const res = response(); await handleAdminEmails(request(), res as unknown as VercelResponse);
      expect(res.body).toMatchObject({ billingEmailConfigured: true, authTemplatesUrl: 'https://supabase.com/dashboard/project/exampleproject/auth/templates', previews: expect.any(Array) });
      expect(JSON.stringify(res.body)).toContain('PREVIEW-NOT-A-VALID-LINK');
      expect(JSON.stringify(res.body)).not.toContain('DO-NOT-RETURN');
      const wrong = response(); await handleAdminEmails(request('POST'), wrong as unknown as VercelResponse);
      expect(wrong.statusCode).toBe(405);
    } finally { vi.unstubAllEnvs(); }
  });
});
