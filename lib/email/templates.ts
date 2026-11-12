import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient, logEvent, withTimeout } from '../http';
import { isEmailDocument } from '../../shared/email-document';
import {
  EMAIL_TEMPLATE_IDS,
  SUPABASE_AUTH_ACTION_URLS,
  emailTemplateDefinition,
  emailTemplateSettingKey,
  fallbackEmailTemplate,
  renderEmailTemplate,
  type EmailTemplate,
  type StoredEmailTemplate,
  type EmailTemplateId,
  type AuthSyncResult,
  type AuthSyncStatus,
  type AuthTemplateId,
  type RenderedEmail,
} from '../../shared/email-templates';

/**
 * The editable emails' storage and their Supabase side (owner, 12 November 2026). A template lives in
 * `app_settings` (service role only, RLS without policies). A missing, unreadable or invalid row falls
 * back to the code's wording, so a broken store never stops an email.
 *
 * The account emails are Supabase Auth's: saving one PATCHes the hosted auth config through the
 * Management API with SUPABASE_MANAGEMENT_API_TOKEN, a server-only personal access token. Without it the
 * text is saved here and the administration says it has not reached Supabase.
 */
const TABLE = 'app_settings';
const CACHE_TTL_MS = 30_000;
const MANAGEMENT_API = 'https://api.supabase.com/v1';

export type { StoredEmailTemplate } from '../../shared/email-templates';

let defaultDb: SupabaseClient | null | undefined;
const db = () => (defaultDb === undefined ? (defaultDb = createServiceClient()) : defaultDb);
const cache = new Map<EmailTemplateId, { at: number; value: StoredEmailTemplate }>();

/** Tests only: a fake store, or null for none. */
export function setEmailTemplateStoreForTests(client: SupabaseClient | null) {
  defaultDb = client;
  cache.clear();
}

function parseStored(id: EmailTemplateId, row: { value?: unknown; updated_at?: string } | null): StoredEmailTemplate {
  const value = row?.value as { subject?: unknown; document?: unknown } | undefined;
  if (value && typeof value.subject === 'string' && value.subject.trim() && isEmailDocument(value.document)) {
    return { subject: value.subject.trim(), document: value.document, custom: true, updatedAt: row?.updated_at ?? null };
  }
  return { ...fallbackEmailTemplate(id), custom: false, updatedAt: null };
}

export async function loadEmailTemplate(id: EmailTemplateId): Promise<StoredEmailTemplate> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const client = db();
  let value = parseStored(id, null);
  if (client) {
    try {
      const { data, error } = await withTimeout(client.from(TABLE).select('value,updated_at').eq('key', emailTemplateSettingKey(id)).maybeSingle(), 3000);
      if (error) throw new Error(error.message);
      value = parseStored(id, data);
    } catch {
      logEvent('email', { level: 'warn', kind: 'template_unavailable', template: id });
      return value;
    }
  }
  cache.set(id, { at: Date.now(), value });
  return value;
}

export async function loadAllEmailTemplates(): Promise<Record<EmailTemplateId, StoredEmailTemplate>> {
  const entries = await Promise.all(EMAIL_TEMPLATE_IDS.map(async id => [id, await loadEmailTemplate(id)] as const));
  return Object.fromEntries(entries) as Record<EmailTemplateId, StoredEmailTemplate>;
}

export async function saveEmailTemplate(id: EmailTemplateId, template: EmailTemplate): Promise<StoredEmailTemplate> {
  const client = db();
  if (!client) throw new Error('not_configured');
  const updatedAt = new Date().toISOString();
  const value = { subject: template.subject.trim(), document: template.document };
  const { error } = await withTimeout(client.from(TABLE).upsert({ key: emailTemplateSettingKey(id), value, updated_at: updatedAt }, { onConflict: 'key' }), 5000);
  if (error) throw new Error(error.message);
  const stored: StoredEmailTemplate = { ...value, custom: true, updatedAt };
  cache.set(id, { at: Date.now(), value: stored });
  return stored;
}

/** Back to the code's wording: the row is removed, nothing else is. */
export async function resetEmailTemplate(id: EmailTemplateId): Promise<StoredEmailTemplate> {
  const client = db();
  if (!client) throw new Error('not_configured');
  const { error } = await withTimeout(client.from(TABLE).delete().eq('key', emailTemplateSettingKey(id)), 5000);
  if (error) throw new Error(error.message);
  const stored = parseStored(id, null);
  cache.set(id, { at: Date.now(), value: stored });
  return stored;
}

/** The current template of `id` with its variables filled in. */
export async function renderStoredEmail(id: EmailTemplateId, variables: Record<string, string>): Promise<RenderedEmail> {
  return renderEmailTemplate(await loadEmailTemplate(id), variables);
}

// ---- Supabase Auth ---------------------------------------------------------------------------------

const AUTH_FIELDS: Record<AuthTemplateId, { subject: string; content: string }> = {
  signup_confirmation: { subject: 'mailer_subjects_confirmation', content: 'mailer_templates_confirmation_content' },
  password_reset: { subject: 'mailer_subjects_recovery', content: 'mailer_templates_recovery_content' },
  magic_link: { subject: 'mailer_subjects_magic_link', content: 'mailer_templates_magic_link_content' },
};
export const isAuthTemplateId = (id: EmailTemplateId): id is AuthTemplateId => emailTemplateDefinition(id).delivery === 'supabase_auth';

function managementAccess(env: Record<string, string | undefined> = process.env): { ref: string; token: string } | null {
  const token = env.SUPABASE_MANAGEMENT_API_TOKEN?.trim();
  let ref: string | undefined;
  try { ref = new URL(env.SUPABASE_URL ?? '').hostname.match(/^([a-z0-9]+)\.supabase\.co$/)?.[1]; } catch { ref = undefined; }
  return token && ref ? { ref, token } : null;
}

/**
 * Supabase renders its templates with Go's text/template, so an editor's literal `{{` would become a
 * directive. Braces in the text are split; only the system's own `{{ .Email }}` and links stay live.
 */
const inertBraces = (value: string) => value.replaceAll('{{', '{ {').replaceAll('}}', '} }');
const inertDocument = (template: EmailTemplate): EmailTemplate =>
  ({ subject: inertBraces(template.subject), document: JSON.parse(JSON.stringify(template.document), (key, v) => (key === 'text' && typeof v === 'string' ? inertBraces(v) : v)) });

/** The subject and HTML Supabase should hold for an account template. Exported for the tests. */
export function supabaseAuthTemplate(id: AuthTemplateId, template: EmailTemplate): { subject: string; html: string } {
  const rendered = renderEmailTemplate(inertDocument(template), { email: '{{ .Email }}' },
    { url: SUPABASE_AUTH_ACTION_URLS[id], label: emailTemplateDefinition(id).actionLabel! });
  return { subject: rendered.subject, html: rendered.html };
}

export async function syncAuthTemplate(id: EmailTemplateId, template: EmailTemplate, fetchImpl: typeof fetch = fetch): Promise<AuthSyncResult> {
  if (!isAuthTemplateId(id)) return { synced: true };
  const access = managementAccess();
  if (!access) return { synced: false, reason: 'not_configured' };
  const { subject, html } = supabaseAuthTemplate(id, template);
  try {
    const response = await fetchImpl(`${MANAGEMENT_API}/projects/${access.ref}/config/auth`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${access.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ [AUTH_FIELDS[id].subject]: subject, [AUTH_FIELDS[id].content]: html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) return { synced: true };
    logEvent('email', { level: 'warn', kind: 'auth_template_sync_failed', template: id, status: response.status });
    return { synced: false, reason: 'request_failed', status: response.status };
  } catch {
    logEvent('email', { level: 'warn', kind: 'auth_template_sync_failed', template: id, status: 0 });
    return { synced: false, reason: 'request_failed' };
  }
}

/** Whether the token works, and which hosted templates carry devShark's own text (its "devShark" wordmark). */
export async function authSyncStatus(fetchImpl: typeof fetch = fetch): Promise<AuthSyncStatus> {
  const access = managementAccess();
  if (!access) return { configured: false };
  try {
    const response = await fetchImpl(`${MANAGEMENT_API}/projects/${access.ref}/config/auth`, {
      headers: { Authorization: `Bearer ${access.token}` }, signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return { configured: true, ok: false, status: response.status };
    const config = (await response.json()) as Record<string, unknown>;
    const synced = Object.fromEntries((Object.keys(AUTH_FIELDS) as AuthTemplateId[]).map(id => {
      const content = config[AUTH_FIELDS[id].content];
      return [id, typeof content === 'string' && content.includes('devShark') && content.includes(SUPABASE_AUTH_ACTION_URLS[id].split('?')[0]!)];
    })) as Record<AuthTemplateId, boolean>;
    return { configured: true, ok: true, synced };
  } catch {
    return { configured: true, ok: false };
  }
}
