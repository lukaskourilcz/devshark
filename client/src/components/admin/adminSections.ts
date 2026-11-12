import type { TranslationKey } from '../../i18n/translations';

/** The administration's sections and their navigation groups (admin UX review, 12 November 2026). */
export const ADMIN_GROUPS = [
  { label: 'admin.group.learners', sections: ['users', 'vouchers'] },
  { label: 'admin.group.content', sections: ['questions', 'triage', 'quality', 'paths', 'flags'] },
  { label: 'admin.group.communication', sections: ['emails'] },
  { label: 'admin.group.more', sections: ['settings', 'logs', 'merch'], collapsible: true },
] as const satisfies ReadonlyArray<{ label: TranslationKey; sections: readonly string[]; collapsible?: boolean }>;

export type AdminSection = (typeof ADMIN_GROUPS)[number]['sections'][number];
export const ADMIN_SECTIONS: readonly AdminSection[] = ADMIN_GROUPS.flatMap(group => [...group.sections]);
export const isAdminSection = (value: string): value is AdminSection => (ADMIN_SECTIONS as readonly string[]).includes(value);
export const adminPath = (section: AdminSection) => (section === 'users' ? '/admin' : '/admin/' + section);
