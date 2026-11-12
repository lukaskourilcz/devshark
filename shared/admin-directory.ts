import type { EmailDocument } from './email-document';
import type { AuthSyncResult, AuthSyncStatus, EmailTemplateId, StoredEmailTemplate } from './email-templates';
import type { EntitlementResponse } from './tiers';

export interface AdminUserVoucher {
  voucherId: string;
  hint: string;
  note: string;
  redeemedAt: string;
  validUntil: string | null;
  status: string;
}

export interface AdminDirectoryUser {
  id: string;
  email: string | null;
  name: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  emailConfirmed: boolean;
  providers: string[];
  plan: EntitlementResponse;
  vouchers: AdminUserVoucher[];
}

export interface AdminDirectory {
  users: AdminDirectoryUser[];
  page: number;
  pageSize: number;
  total: number;
  hasNextPage: boolean;
  voucherHistoryPartial: boolean;
}

export interface AdminEmails {
  /** RESEND_API_KEY is set, so application emails are handed to Resend. */
  deliveryConfigured: boolean;
  billingEnabled: boolean;
  sender: string;
  replyTo: string;
  authTemplatesUrl: string | null;
  templates: Record<EmailTemplateId, StoredEmailTemplate>;
  authSync: AuthSyncStatus;
}

export type AdminEmailRequest =
  | { action: 'save'; id: EmailTemplateId; subject: string; document: EmailDocument }
  | { action: 'reset'; id: EmailTemplateId }
  | { action: 'test'; id: EmailTemplateId; to: string };

export type AdminEmailResponse =
  | { template: StoredEmailTemplate; authSync: AuthSyncResult | null }
  | { sent: true };
