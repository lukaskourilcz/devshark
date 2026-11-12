import type { SupabaseClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from './vercel-types.js';
import { isRpcMissing, jsonError, withTimeout } from './http';
import { toEntitlementResponse } from './entitlements';
import { billingConfig } from './billing/config';
import { DEFAULT_EMAIL_FROM, DEFAULT_EMAIL_REPLY_TO, emailConfig, sendEmail } from './email/resend';
import { authSyncStatus, isAuthTemplateId, loadAllEmailTemplates, loadEmailTemplate, resetEmailTemplate, saveEmailTemplate, syncAuthTemplate } from './email/templates';
import { isEmailDocument } from '../shared/email-document';
import { EMAIL_SAMPLE_VARIABLES, emailTemplateProblem, isEmailTemplateId, renderEmailTemplate, sampleEmailAction } from '../shared/email-templates';
import type { AdminDirectory, AdminEmailResponse, AdminEmails, AdminUserVoucher } from '../shared/admin-directory';

const PAGE_SIZE = 25;
const HISTORY_LIMIT = 1000;
const first = <T>(value: T | T[] | null): T | null => Array.isArray(value) ? value[0] ?? null : value;

/** Called only after the existing route-level requireAdmin gate. Auth's
 * administrative API includes old accounts even without an auth_events row.
 * No tokens, identities, passwords or raw metadata leave this handler. */
export async function handleAdminUsers(req: VercelRequest, res: VercelResponse, db: SupabaseClient | null) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  if (!db) return jsonError(res, 503, 'not_configured', 'Account storage is not configured');
  const raw = req.query.page;
  if (raw !== undefined && (typeof raw !== 'string' || !/^[1-9]\d{0,5}$/.test(raw))) {
    return jsonError(res, 400, 'bad_request', 'page must be a positive whole number');
  }
  const page = raw === undefined ? 1 : Number(raw);
  const listed = await withTimeout(db.auth.admin.listUsers({ page, perPage: PAGE_SIZE }));
  if (listed.error) return jsonError(res, 503, 'users_unavailable', 'Users could not be loaded. Try again.');
  const users = listed.data.users;
  const ids = users.map(user => user.id);
  const history = ids.length ? await withTimeout(db.from('premium_voucher_redemptions')
    .select('user_id,redeemed_at,voucher:premium_vouchers(id,code_hint,note),grant:entitlement_grants(valid_until,status)', { count: 'exact' })
    .in('user_id', ids).order('redeemed_at', { ascending: false }).limit(HISTORY_LIMIT)) : { data: [], error: null, count: 0 };
  if (history.error) return jsonError(res, 503, 'voucher_history_unavailable', 'Voucher history could not be loaded. Try again.');
  // Use the canonical entitlement routine; do not reconstruct Premium from
  // dates in the browser or let a stale grant keep an account Premium.
  const plans = await Promise.all(users.map(user => withTimeout(db.rpc('entitlement_summary', { p_user: user.id }))));
  if (plans.some(result => result.error)) {
    return jsonError(res, 503, plans.some(result => isRpcMissing(result.error)) ? 'migration_required' : 'plans_unavailable', 'Premium status could not be loaded. Try again.');
  }
  const rows = history.data ?? [];
  const body: AdminDirectory = {
    page, pageSize: PAGE_SIZE, total: listed.data.total,
    hasNextPage: page * PAGE_SIZE < listed.data.total,
    voucherHistoryPartial: (history.count ?? 0) > rows.length,
    users: users.map((user, index) => ({
      id: user.id, email: user.email ?? null,
      name: typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : null,
      createdAt: user.created_at, lastSignInAt: user.last_sign_in_at ?? null,
      emailConfirmed: !!user.email_confirmed_at,
      providers: Array.isArray(user.app_metadata.providers) ? user.app_metadata.providers.filter((p: unknown): p is string => typeof p === 'string') : [],
      plan: toEntitlementResponse(plans[index].data),
      vouchers: rows.filter(row => row.user_id === user.id).flatMap((row): AdminUserVoucher[] => {
        const voucher = first(row.voucher); const grant = first(row.grant);
        return voucher && grant ? [{ voucherId: voucher.id, hint: voucher.code_hint, note: voucher.note,
          redeemedAt: row.redeemed_at, validUntil: grant.valid_until, status: grant.status }] : [];
      }),
    })),
  };
  return res.json(body);
}

const EMAIL_ADDRESS = /^[^\s@<>",;]{1,64}@[^\s@<>",;]{1,255}\.[a-z]{2,}$/i;

/**
 * The email editor (owner, 12 November 2026, after the NAVIGYM administration). Called only after the
 * route-level requireAdmin gate. GET lists every template with its delivery state; POST saves one,
 * resets it to the code's wording, or sends it once with sample values to an address the admin types.
 * No provider key, token or live link ever leaves this handler.
 */
export async function handleAdminEmails(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method === 'GET') {
    const config = billingConfig();
    let authTemplatesUrl: string | null = null;
    try {
      const host = new URL(process.env.SUPABASE_URL ?? '').hostname;
      const ref = host.match(/^([a-z0-9]+)\.supabase\.co$/)?.[1];
      if (ref) authTemplatesUrl = 'https://supabase.com/dashboard/project/' + ref + '/auth/templates';
    } catch { /* Custom/self-hosted deployments have no hosted dashboard link. */ }
    const sending = emailConfig() ?? { from: DEFAULT_EMAIL_FROM, replyTo: DEFAULT_EMAIL_REPLY_TO };
    const [templates, authSync] = await Promise.all([loadAllEmailTemplates(), authSyncStatus()]);
    const body: AdminEmails = {
      deliveryConfigured: config.email !== null, billingEnabled: config.checkoutEnabled,
      sender: sending.from, replyTo: sending.replyTo, authTemplatesUrl, templates, authSync,
    };
    return res.json(body);
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  const b = (req.body || {}) as Record<string, unknown>;
  if (!isEmailTemplateId(b.id)) return jsonError(res, 400, 'bad_request', 'Unknown email template');
  const id = b.id;
  if (b.action === 'save') {
    if (typeof b.subject !== 'string' || !isEmailDocument(b.document)) {
      return jsonError(res, 400, 'bad_request', 'The email formatting is not valid or is too long.');
    }
    const template = { subject: b.subject.trim(), document: b.document };
    const problem = emailTemplateProblem(id, template);
    if (problem) return jsonError(res, 400, 'bad_request', problem);
    let saved;
    try { saved = await saveEmailTemplate(id, template); } catch {
      return jsonError(res, 503, 'storage_unavailable', 'The template could not be saved. Try again.');
    }
    const body: AdminEmailResponse = { template: saved, authSync: isAuthTemplateId(id) ? await syncAuthTemplate(id, saved) : null };
    return res.json(body);
  }
  if (b.action === 'reset') {
    let saved;
    try { saved = await resetEmailTemplate(id); } catch {
      return jsonError(res, 503, 'storage_unavailable', 'The template could not be reset. Try again.');
    }
    const body: AdminEmailResponse = { template: saved, authSync: isAuthTemplateId(id) ? await syncAuthTemplate(id, saved) : null };
    return res.json(body);
  }
  if (b.action === 'test') {
    const to = typeof b.to === 'string' ? b.to.trim() : '';
    if (!EMAIL_ADDRESS.test(to)) return jsonError(res, 400, 'bad_request', 'Enter one valid email address.');
    const config = emailConfig();
    if (!config) return jsonError(res, 503, 'not_configured', 'RESEND_API_KEY is not set, so no email can be sent.');
    // The saved wording with clearly fictional values; an account email's button leads to a harmless page.
    const rendered = renderEmailTemplate(await loadEmailTemplate(id), EMAIL_SAMPLE_VARIABLES, sampleEmailAction(id, billingConfig().origin));
    const sent = await sendEmail(config, to, { ...rendered, subject: '[Test] ' + rendered.subject });
    if (!sent) return jsonError(res, 502, 'email_failed', 'Resend did not accept the email. Check the domain and the key in Resend.');
    const body: AdminEmailResponse = { sent: true };
    return res.json(body);
  }
  return jsonError(res, 400, 'bad_request', 'Unknown action');
}
