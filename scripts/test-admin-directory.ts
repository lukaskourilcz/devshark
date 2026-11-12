import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '../lib/vercel-types';
import { handleAdminUsers, handleAdminEmails } from '../lib/admin-directory';
import { handleAdminVouchers } from '../lib/vouchers';
import { setEmailTemplateStoreForTests, supabaseAuthTemplate } from '../lib/email/templates';
import { isEmailDocument, type EmailDocument } from '../shared/email-document';
import { renderEmailTemplate } from '../shared/email-templates';

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

  const previous = { resend: process.env.RESEND_API_KEY, url: process.env.SUPABASE_URL, token: process.env.SUPABASE_MANAGEMENT_API_TOKEN };
  process.env.RESEND_API_KEY = 'DO-NOT-RETURN'; process.env.SUPABASE_URL = 'https://exampleproject.supabase.co';
  delete process.env.SUPABASE_MANAGEMENT_API_TOKEN;
  // An in-memory app_settings: select … eq … maybeSingle, upsert, delete … eq.
  const rows = new Map<string, { value: unknown; updated_at: string }>();
  const settingsDb = { from: () => {
    let key = ''; let deleting = false;
    const chain = {
      select: () => chain,
      eq: (_column: string, value: string) => { key = value; if (deleting) { rows.delete(key); return Promise.resolve({ error: null }); } return chain; },
      maybeSingle: async () => ({ data: rows.get(key) ?? null, error: null }),
      upsert: async (row: { key: string; value: unknown; updated_at: string }) => { rows.set(row.key, { value: row.value, updated_at: row.updated_at }); return { error: null }; },
      delete: () => { deleting = true; return chain; },
    };
    return chain;
  } } as unknown as SupabaseClient;
  setEmailTemplateStoreForTests(settingsDb);
  const post = (body: unknown) => ({ method: 'POST', query: {}, body }) as unknown as VercelRequest;
  const doc = (text: string): EmailDocument => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  try {
    const emails = response(); await handleAdminEmails(request(), emails as unknown as VercelResponse);
    assert.equal(emails.body.deliveryConfigured, true);
    assert.equal(emails.body.sender, 'devShark <noreply@devshark.app>');
    assert.equal(emails.body.replyTo, 'support@devshark.app');
    assert.equal(emails.body.authTemplatesUrl, 'https://supabase.com/dashboard/project/exampleproject/auth/templates');
    assert.deepEqual(emails.body.authSync, { configured: false });
    assert.equal(Object.keys(emails.body.templates).length, 7);
    assert.equal(emails.body.templates.cancelled.custom, false);
    assert.equal(emails.body.templates.cancelled.subject, 'Your devShark Premium cancellation');
    assert.doesNotMatch(JSON.stringify(emails.body), /DO-NOT-RETURN/);

    const statusOf = async (body: unknown) => { const res = response(); await handleAdminEmails(post(body), res as unknown as VercelResponse); return res; };
    assert.equal((await statusOf({ action: 'save', id: 'nope', subject: 'x', document: doc('x') })).statusCode, 400, 'unknown template');
    assert.equal((await statusOf({ action: 'save', id: 'cancelled', subject: 'x', document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link' }] }] }] } })).statusCode, 400, 'no links or other marks');
    assert.equal((await statusOf({ action: 'save', id: 'cancelled', subject: 'x', document: '<p>html</p>' })).statusCode, 400, 'no HTML');
    assert.equal((await statusOf({ action: 'save', id: 'cancelled', subject: '  ', document: doc('Body') })).statusCode, 400, 'empty subject');
    const noLink = await statusOf({ action: 'save', id: 'cancel_link', subject: 'Confirm', document: doc('No link here') });
    assert.equal(noLink.statusCode, 400); assert.match(JSON.stringify(noLink.body), /\{link\}/);
    assert.equal(rows.size, 0, 'nothing invalid is stored');

    const saved = await statusOf({ action: 'save', id: 'cancelled', subject: ' Cancelled ', document: doc('Bye {profile_url}') });
    assert.equal(saved.statusCode, 200); assert.equal(saved.body.template.custom, true);
    assert.equal(saved.body.template.subject, 'Cancelled'); assert.equal(saved.body.authSync, null);
    assert.ok(rows.has('email_template:cancelled'));
    const account = await statusOf({ action: 'save', id: 'password_reset', subject: 'Reset', document: doc('New password for {email}') });
    assert.deepEqual(account.body.authSync, { synced: false, reason: 'not_configured' }, 'saved here, Supabase not reached without a token');
    const reset = await statusOf({ action: 'reset', id: 'cancelled' });
    assert.equal(reset.body.template.custom, false); assert.ok(!rows.has('email_template:cancelled'));

    assert.equal((await statusOf({ action: 'test', id: 'cancelled', to: 'not an address' })).statusCode, 400);
    assert.equal((await statusOf({ action: 'test', id: 'cancelled', to: 'a@b.co, c@d.co' })).statusCode, 400, 'one address only');
    delete process.env.RESEND_API_KEY;
    assert.equal((await statusOf({ action: 'test', id: 'cancelled', to: 'admin@example.com' })).statusCode, 503, 'no key, no email');
    const wrong = response(); await handleAdminEmails(request('PUT'), wrong as unknown as VercelResponse);
    assert.equal(wrong.statusCode, 405);

    // Rendering: values stay literal, the code's wording is the fallback, Supabase directives cannot be typed in.
    const rendered = renderEmailTemplate({ subject: 'Hi {email}', document: doc('Hello {email}') }, { email: '<b>x</b>' });
    assert.equal(rendered.subject, 'Hi <b>x</b>'); assert.match(rendered.html, /Hello &lt;b&gt;x&lt;\/b&gt;/); assert.doesNotMatch(rendered.html, /<b>x/);
    const auth = supabaseAuthTemplate('signup_confirmation', { subject: 'Confirm {{ .Token }}', document: doc('Hi {email} {{ .Token }}') });
    assert.match(auth.html, /Hi \{\{ \.Email \}\}/); assert.doesNotMatch(auth.html, /\{\{ \.Token \}\}/, 'a typed directive stays inert'); assert.doesNotMatch(auth.subject, /\{\{/);
    assert.match(auth.html, /\/auth\/confirmed\?token_hash=\{\{ \.TokenHash \}\}&amp;type=email/);
    assert.equal(isEmailDocument({ type: 'doc', content: [] }), false, 'an empty document is refused');
  } finally {
    setEmailTemplateStoreForTests(null);
    if (previous.resend === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previous.resend;
    if (previous.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previous.url;
    if (previous.token !== undefined) process.env.SUPABASE_MANAGEMENT_API_TOKEN = previous.token;
  }
  console.log('PASS admin emails: templates save, validate, reset and test-send without leaking credentials; rendering stays literal');

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
