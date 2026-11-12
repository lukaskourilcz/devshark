import {
  emailDocumentHtml,
  emailDocumentToText,
  emailDocumentVariables,
  escapeEmailHtml,
  replaceEmailVariables,
  textEmailDocument,
  type EmailDocument,
} from './email-document';

/**
 * Every email devShark sends, editable in the administration (owner, 12 November 2026, after the
 * NAVIGYM administration). A saved subject and body live in `app_settings` under
 * `emailTemplateSettingKey(id)`; without one the fallback below is sent, which is the wording the
 * code sent before templates existed. The three account emails are delivered by Supabase Auth: saving
 * one also writes it into Supabase's hosted templates (lib/email/templates.ts).
 */
export const EMAIL_TEMPLATE_IDS = [
  'signup_confirmation',
  'password_reset',
  'magic_link',
  'cancel_link',
  'withdraw_link',
  'cancelled',
  'withdrawn',
] as const;
export type EmailTemplateId = (typeof EMAIL_TEMPLATE_IDS)[number];

export interface EmailTemplate {
  subject: string;
  document: EmailDocument;
}

export interface EmailTemplateDefinition {
  id: EmailTemplateId;
  label: string;
  description: string;
  /** Every variable the body may use, such as `{email}`. */
  variables: readonly string[];
  /** Variables a saved body must keep: without `{link}` a confirmation email confirms nothing. */
  required: readonly string[];
  delivery: 'application' | 'supabase_auth';
  /** The button an account email carries; the system adds it under the text. */
  actionLabel?: string;
  fallback: { subject: string; body: string };
}

const SUPABASE_VARIABLES = ['{email}'] as const;

export const EMAIL_TEMPLATE_DEFINITIONS: readonly EmailTemplateDefinition[] = [
  {
    id: 'signup_confirmation', label: 'Confirm signup', delivery: 'supabase_auth', actionLabel: 'Confirm my email',
    description: 'Sent by Supabase Auth when someone creates an account. The confirmation button is added automatically.',
    variables: SUPABASE_VARIABLES, required: [],
    fallback: {
      subject: 'Confirm your devShark email',
      body: 'Press the button to confirm {email} and finish creating your devShark account.\n\nThe link works once and expires in an hour. If you did not create a devShark account, ignore this email: nothing happens unless the button is pressed.',
    },
  },
  {
    id: 'password_reset', label: 'Reset password', delivery: 'supabase_auth', actionLabel: 'Set a new password',
    description: 'Sent by Supabase Auth when someone asks for a new password. The button is added automatically.',
    variables: SUPABASE_VARIABLES, required: [],
    fallback: {
      subject: 'Reset your devShark password',
      body: 'Press the button to set a new password for the devShark account of {email}.\n\nThe link works once and expires in an hour. If you did not ask for a new password, ignore this email: your password stays as it is.',
    },
  },
  {
    id: 'magic_link', label: 'Magic link', delivery: 'supabase_auth', actionLabel: 'Sign in',
    description: 'devShark never asks for a magic link, but Supabase Auth can send one through its API. The sign-in button is added automatically.',
    variables: SUPABASE_VARIABLES, required: [],
    fallback: {
      subject: 'Your devShark sign-in link',
      body: 'Press the button to sign in to devShark as {email}.\n\nThe link works once and expires in an hour. If you did not ask to sign in, ignore this email.',
    },
  },
  {
    id: 'cancel_link', label: 'Confirm cancellation', delivery: 'application',
    description: 'Sent when someone asks on the public cancellation page to cancel Premium. Nothing changes until the link is opened.',
    variables: ['{received_at}', '{minutes}', '{link}'], required: ['{link}'],
    fallback: {
      subject: 'Confirm your devShark Premium cancellation',
      body: 'On {received_at} UTC someone asked on devshark.app to cancel the devShark Premium subscription of this email address.\n\nIf it was you, open this link within {minutes} minutes and confirm: {link}\n\nNothing changes until you confirm. If it was not you, or no devShark Premium subscription uses this address, ignore this email.',
    },
  },
  {
    id: 'withdraw_link', label: 'Confirm withdrawal', delivery: 'application',
    description: 'Sent when someone asks on the public cancellation page to withdraw within 14 days. Nothing changes until the link is opened.',
    variables: ['{received_at}', '{minutes}', '{link}'], required: ['{link}'],
    fallback: {
      subject: 'Confirm your devShark Premium withdrawal',
      body: 'On {received_at} UTC someone asked on devshark.app to withdraw from the devShark Premium subscription of this email address.\n\nIf it was you, open this link within {minutes} minutes and confirm: {link}\n\nNothing changes until you confirm. If it was not you, or no devShark Premium subscription uses this address, ignore this email.',
    },
  },
  {
    id: 'cancelled', label: 'Cancellation receipt', delivery: 'application',
    description: 'Sent after a Premium subscription is cancelled at the end of its period.',
    variables: ['{received_at}', '{ends_at}', '{profile_url}'], required: [],
    fallback: {
      subject: 'Your devShark Premium cancellation',
      body: 'We received your cancellation on {received_at} UTC.\n\nPremium stays open until {ends_at}. You will not be charged again.\n\nChanged your mind? Open Manage billing on your profile before that date: {profile_url}',
    },
  },
  {
    id: 'withdrawn', label: 'Withdrawal receipt', delivery: 'application',
    description: 'Sent after a withdrawal ends a subscription at once. {refund_note} says whether the payment was refunded.',
    variables: ['{received_at}', '{refund_note}'], required: [],
    fallback: {
      subject: 'Your devShark Premium withdrawal',
      body: 'We received your withdrawal on {received_at} UTC.\n\n{refund_note}\n\nEverything you passed stays in your account on the free plan.',
    },
  },
];

export function isEmailTemplateId(value: unknown): value is EmailTemplateId {
  return typeof value === 'string' && (EMAIL_TEMPLATE_IDS as readonly string[]).includes(value);
}

export function emailTemplateDefinition(id: EmailTemplateId): EmailTemplateDefinition {
  const definition = EMAIL_TEMPLATE_DEFINITIONS.find(template => template.id === id);
  if (!definition) throw new Error(`Unknown email template: ${id}`);
  return definition;
}

export const emailTemplateSettingKey = (id: EmailTemplateId) => `email_template:${id}`;

export function fallbackEmailTemplate(id: EmailTemplateId): EmailTemplate {
  const { fallback } = emailTemplateDefinition(id);
  return { subject: fallback.subject, document: textEmailDocument(fallback.body) };
}

export const EMAIL_SUBJECT_MAX = 200;

/** Why a template cannot be saved, or null. */
export function emailTemplateProblem(id: EmailTemplateId, template: EmailTemplate): string | null {
  const subject = template.subject.trim();
  if (!subject) return 'The subject cannot be empty.';
  if (subject.length > EMAIL_SUBJECT_MAX) return `Keep the subject under ${EMAIL_SUBJECT_MAX} characters.`;
  if (!emailDocumentToText(template.document).trim()) return 'The email cannot be empty.';
  const used = emailDocumentVariables(template.document);
  const missing = emailTemplateDefinition(id).required.filter(variable => !used.includes(variable));
  if (missing.length) return `Keep ${missing.join(', ')} in the text: without it the email does not work.`;
  return null;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/** devShark's palette in literal hex (a mail client reads no CSS variable), as docs/auth-email-templates.md set it. */
const MAIL = {
  page: '#f4f6f3',
  surface: '#ffffff',
  border: '#dde3dc',
  brand: '#2d7a2d',
  text: '#132019',
  muted: '#4a5a66',
  onBrand: '#ffffff',
  font: 'Inter,Arial,sans-serif',
} as const;

export type EmailAction = { url: string; label: string };

/**
 * One centred 560px column: the wordmark, the body and the button an account email carries. Tables and
 * inline styles because that is the markup every mail client, Outlook included, agrees on.
 */
function emailHtmlShell(body: string, action?: EmailAction): string {
  const button = action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 8px;border-collapse:collapse"><tr><td style="background:${MAIL.brand};border-radius:10px"><a href="${escapeEmailHtml(action.url)}" style="display:inline-block;padding:12px 20px;font-family:${MAIL.font};font-size:15px;font-weight:bold;line-height:1.2;color:${MAIL.onBrand};text-decoration:none">${escapeEmailHtml(action.label)}</a></td></tr></table>`
    : '';
  return `<div style="margin:0;background:${MAIL.page};padding:24px 12px;font-family:${MAIL.font};color:${MAIL.text}">`
    + `<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" align="center" style="width:100%;max-width:560px;border-collapse:collapse;background:${MAIL.surface};border:1px solid ${MAIL.border};border-radius:12px">`
    + `<tr><td style="padding:24px 24px 0"><p style="margin:0 0 20px;font-family:${MAIL.font};font-weight:800;font-size:20px;color:${MAIL.brand}">devShark</p>${body}${button}</td></tr>`
    + `<tr><td style="padding:8px 24px 24px;font-family:${MAIL.font};font-size:13px;line-height:1.6;color:${MAIL.muted}">devshark.app</td></tr>`
    + `</table></div>`;
}

/** Subject, plain text and HTML of one template with its variables filled in. */
export function renderEmailTemplate(template: EmailTemplate, variables: Record<string, string>, action?: EmailAction): RenderedEmail {
  const text = emailDocumentToText(template.document, variables);
  return {
    subject: replaceEmailVariables(template.subject, variables).trim(),
    // A button exists only in the HTML part, so the plain-text part repeats its address.
    text: action ? `${text}\n\n${action.label}: ${action.url}` : text,
    html: emailHtmlShell(emailDocumentHtml(template.document, variables, { font: MAIL.font, color: MAIL.text }), action),
  };
}

/** Clearly fictional values for the preview and the test email. */
export const EMAIL_SAMPLE_VARIABLES: Record<string, string> = {
  email: 'learner@example.com',
  received_at: '25 September 2026 at 14:32',
  minutes: '60',
  link: 'https://devshark.app/premium/cancel#confirm=PREVIEW-NOT-A-VALID-LINK',
  ends_at: '12 November 2026',
  profile_url: 'https://devshark.app/profile',
  refund_note: 'Your subscription ended at once and we refunded your payment in full. Your bank may take 5 to 10 days to show it.',
};

/** Where each Supabase Auth button leads in Supabase's own template language (docs/auth-email-templates.md). */
export const SUPABASE_AUTH_ACTION_URLS: Record<'signup_confirmation' | 'password_reset' | 'magic_link', string> = {
  signup_confirmation: '{{ .SiteURL }}/auth/confirmed?token_hash={{ .TokenHash }}&type=email',
  password_reset: '{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery',
  magic_link: '{{ .ConfirmationURL }}',
};

/** The button of a template, with a harmless address for the preview and the test email. */
export function sampleEmailAction(id: EmailTemplateId, origin = 'https://devshark.app'): EmailAction | undefined {
  const { actionLabel } = emailTemplateDefinition(id);
  if (!actionLabel) return undefined;
  const path = id === 'password_reset' ? '/reset-password' : id === 'signup_confirmation' ? '/auth/confirmed' : '/';
  return { url: origin + path, label: actionLabel };
}
