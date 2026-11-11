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

export interface AdminEmailPreview {
  id: string;
  subject: string;
  text: string;
}

export interface AdminEmails {
  billingEmailConfigured: boolean;
  billingEnabled: boolean;
  sender: string | null;
  authTemplatesUrl: string | null;
  previews: AdminEmailPreview[];
}
