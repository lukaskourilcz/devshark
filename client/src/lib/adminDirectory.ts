import { adminFetch } from './devApi';
import type { AdminDirectory, AdminEmails } from '../../../shared/admin-directory';
export const adminDirectoryKey = (page: number) => ['admin', 'users', page] as const;
export const adminEmailsKey = ['admin', 'emails'] as const;
export const listAdminUsers = (page: number) => adminFetch<AdminDirectory>('users?page=' + page);
export const listAdminEmails = () => adminFetch<AdminEmails>('emails');
