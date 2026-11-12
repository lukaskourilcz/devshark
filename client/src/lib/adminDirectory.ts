import { adminFetch } from './devApi';
import type { AdminDirectory, AdminEmailRequest, AdminEmailResponse, AdminEmails } from '../../../shared/admin-directory';
export const adminDirectoryKey = (page: number) => ['admin', 'users', page] as const;
export const adminEmailsKey = ['admin', 'emails'] as const;
export const listAdminUsers = (page: number) => adminFetch<AdminDirectory>('users?page=' + page);
export const listAdminEmails = () => adminFetch<AdminEmails>('emails');
export const saveAdminEmail = (request: AdminEmailRequest) => adminFetch<AdminEmailResponse>('emails', { method: 'POST', body: request });
