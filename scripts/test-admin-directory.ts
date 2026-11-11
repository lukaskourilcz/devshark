import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '../lib/vercel-types';
import { handleAdminUsers, handleAdminEmails } from '../lib/admin-directory';
import { handleAdminVouchers } from '../lib/vouchers';

const request = (method = 'GET', query: Record<string, unknown> = {}) => ({ method, query }) as VercelRequest;
function response() {
  return { statusCode: 200, body: null as any, headers: {} as Record<string, unknown>,
    setHeader(name: string, value: unknown) { this.headers[name] = value; return this; },
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; } };
}
const fixture = (historyError: unknown = null) => {
  const calls = { pages: [] as unknown[], ids: [] as string[], rpcUsers: [] as string[] };
  const user = { id: 'user-1', email: 'learner@example.invalid', email_confirmed_at: '2026-11-01',
    created_at: '2026-11-01', last_sign_in_at: '2026-11-10', user_metadata: { full_name: 'Learner', private: 'DO-NOT-RETURN' },
    app_metadata: { providers: ['google'], private: 'DO-NOT-RETURN' }, identities: [{ secret: 'DO-NOT-RETURN' }] };
  const history = [{ user_id: user.id, redeemed_at: '2026-11-11', voucher: { id: 'voucher-1', code_hint: 'TEST', note: 'Community' }, grant: { valid_until: '2027-02-09', status: 'active' } }];
  const chain = { select: () => chain, in: (_column: string, ids: string[]) => { calls.ids = ids; return chain; },
    order: () => chain, limit: async () => ({ data: history, count: 1001, error: historyError }) };
  const db = { auth: { admin: { listUsers: async (page: unknown) => { calls.pages.push(page); return { data: { users: [user], total: 30 }, error: null }; } } },
    from: () => chain, rpc: async (_name: string, args: { p_user: string }) => { calls.rpcUsers.push(args.p_user); return { data: { premium: true, source: 'promo', validUntil: '2027-02-09T00:00:00Z' }, error: null }; } };
  return { db: db as unknown as SupabaseClient, calls };
};

/** Runs with the server launch contracts, never through client tooling. */
export async function adminDirectoryContracts() {
  const { db, calls } = fixture(); const res = response();
  await handleAdminUsers(request('GET', { page: '2' }), res as unknown as VercelResponse, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
  assert.deepEqual(calls.pages, [{ page: 2, perPage: 25 }]);
  assert.deepEqual(calls.ids, ['user-1']); assert.deepEqual(calls.rpcUsers, ['user-1']);
  assert.equal(res.body.voucherHistoryPartial, true); assert.equal(res.body.hasNextPage, false);
  assert.equal(res.body.users[0].plan.validUntil, '2027-02-09T00:00:00.000Z');
  assert.equal(res.body.users[0].vouchers[0].hint, 'TEST');
  assert.doesNotMatch(JSON.stringify(res.body), /DO-NOT-RETURN|identities|code_hash|app_metadata|user_metadata/);
  const invalid = fixture();
  for (const page of ['0', '-1', '2x', ['1'], '1000000']) {
    const denied = response(); await handleAdminUsers(request('GET', { page }), denied as unknown as VercelResponse, invalid.db);
    assert.equal(denied.statusCode, 400);
  }
  const wrong = response(); await handleAdminUsers(request('POST'), wrong as unknown as VercelResponse, invalid.db);
  assert.equal(wrong.statusCode, 405); assert.equal(invalid.calls.pages.length, 0);
  const failed = fixture({ message: 'private internal details' }); const failedRes = response();
  await handleAdminUsers(request(), failedRes as unknown as VercelResponse, failed.db);
  assert.equal(failedRes.statusCode, 503); assert.doesNotMatch(JSON.stringify(failedRes.body), /private internal details/);
  console.log('PASS admin directory: bounded pages, canonical Premium, private data redaction and explicit errors');

  const previous = { resend: process.env.RESEND_API_KEY, url: process.env.SUPABASE_URL };
  process.env.RESEND_API_KEY = 'DO-NOT-RETURN'; process.env.SUPABASE_URL = 'https://exampleproject.supabase.co';
  try {
    const emails = response(); await handleAdminEmails(request(), emails as unknown as VercelResponse);
    assert.equal(emails.body.billingEmailConfigured, true);
    assert.equal(emails.body.authTemplatesUrl, 'https://supabase.com/dashboard/project/exampleproject/auth/templates');
    assert.equal(emails.body.previews.length, 4);
    assert.match(JSON.stringify(emails.body), /PREVIEW-NOT-A-VALID-LINK/);
    assert.doesNotMatch(JSON.stringify(emails.body), /DO-NOT-RETURN/);
    const wrong = response(); await handleAdminEmails(request('POST'), wrong as unknown as VercelResponse);
    assert.equal(wrong.statusCode, 405);
  } finally {
    if (previous.resend === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previous.resend;
    if (previous.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previous.url;
  }
  console.log('PASS admin emails: actual message previews contain no provider credentials or valid tokens');

  let error: unknown = null; let update: unknown;
  const chain = { update: (value: unknown) => { update = value; return chain; }, eq: () => chain, select: () => chain,
    maybeSingle: async () => ({ data: { id: 'voucher' }, error }) };
  const voucherDb = { from: () => chain } as unknown as SupabaseClient;
  const cap = (value: unknown) => ({ method: 'POST', body: { action: 'limit', voucherId: '11111111-1111-4111-8111-111111111111', maxRedemptions: value } }) as VercelRequest;
  for (const value of [0, -1, 10001, 1.5, '200', null]) {
    const rejected = response(); await handleAdminVouchers(cap(value), rejected as unknown as VercelResponse, voucherDb);
    assert.equal(rejected.statusCode, 400);
  }
  assert.equal(update, undefined);
  const changed = response(); await handleAdminVouchers(cap(200), changed as unknown as VercelResponse, voucherDb);
  assert.deepEqual(update, { max_redemptions: 200 }); assert.deepEqual(changed.body, { ok: true });
  error = { code: '23514' };
  const used = response(); await handleAdminVouchers(cap(1), used as unknown as VercelResponse, voucherDb);
  assert.equal(used.statusCode, 400); assert.match(JSON.stringify(used.body), /already redeemed/);
  console.log('PASS voucher caps: bounded integer, single-field update and consumed-limit refusal');
}
