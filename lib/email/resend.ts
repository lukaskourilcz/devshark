import { logEvent } from '../http';

/**
 * devShark's application emails through Resend (owner, 12 November 2026). People's mail lives in Zoho
 * (support@devshark.app); what the app sends goes out from noreply@devshark.app through Resend, with replies
 * to support@. Supabase's own sign-in emails reach Resend through its SMTP settings (docs/email-delivery.md);
 * this module is for the emails the API sends itself.
 *
 *   RESEND_API_KEY    a Sending-access key for the devshark.app domain; without it nothing is sent
 *   RESEND_FROM       optional sender, default "devShark <noreply@devshark.app>"
 *   RESEND_REPLY_TO   optional reply address, default support@devshark.app
 */
const log = (event: Record<string, unknown>) => logEvent('email', event);

export const DEFAULT_EMAIL_FROM = 'devShark <noreply@devshark.app>';
export const DEFAULT_EMAIL_REPLY_TO = 'support@devshark.app';

export type EmailConfig = { apiKey: string; from: string; replyTo: string };
/** A plain-text part always; an HTML part when the email came from an editable template. */
export type EmailMessage = { subject: string; text: string; html?: string };

const value = (env: Record<string, string | undefined>, key: string): string | undefined => {
  const raw = env[key]?.trim();
  return raw ? raw : undefined;
};

/** The sending settings, or null while no key is set (nothing is sent then). */
export function emailConfig(env: Record<string, string | undefined> = process.env): EmailConfig | null {
  const apiKey = value(env, 'RESEND_API_KEY');
  if (!apiKey) return null;
  return { apiKey, from: value(env, 'RESEND_FROM') ?? DEFAULT_EMAIL_FROM, replyTo: value(env, 'RESEND_REPLY_TO') ?? DEFAULT_EMAIL_REPLY_TO };
}

/** Sends one email. Never throws: a failure is logged without the address and answers false. */
export async function sendEmail(config: EmailConfig | null, to: string, message: EmailMessage, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!config) return false;
  try {
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.from, to: [to], reply_to: config.replyTo, subject: message.subject, text: message.text,
        ...(message.html ? { html: message.html } : {}) }),
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) log({ level: 'warn', kind: 'email_failed', status: response.status });
    return response.ok;
  } catch {
    log({ level: 'warn', kind: 'email_failed', status: 0 });
    return false;
  }
}
