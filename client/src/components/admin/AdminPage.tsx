import { Suspense, useEffect, useRef, useState, type ComponentType } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Button } from '@astryxdesign/core/Button';
import BrandLogo from '../BrandLogo';
import DevAccess from '../dev/DevAccess';
import { PageHeader } from '../ui/PageHeader';
import LoadingScreen from '../LoadingScreen';
import { useAuth } from '../../lib/auth';
import { useColorMode } from '../../theme/ColorModeContext';
import { useLanguage } from '../../i18n/LanguageContext';
import type { TranslationKey } from '../../i18n/translations';
import { lazyShellPart } from '../../lib/routeRecovery';
import AdminUsers from './AdminUsers';
import { ADMIN_GROUPS, adminPath, isAdminSection, type AdminSection } from './adminSections';
import '../dev/DevConsole.css';
import './AdminPage.css';

/**
 * The one administration (admin UX review, 12 November 2026). Every section the /dev control room
 * had now lives here under grouped navigation, as in the NAVIGYM administration; /dev redirects.
 */
const lazy = (load: () => Promise<{ default: ComponentType }>) => lazyShellPart(load);
const PARTS = {
  users: AdminUsers,
  vouchers: lazy(() => import('../dev/DevVouchers')),
  emails: lazy(() => import('./AdminEmails')),
  questions: lazy(() => import('../dev/DevQuestions')),
  triage: lazy(() => import('../dev/DevTriage')),
  quality: lazy(() => import('../dev/DevQuality')),
  paths: lazy(() => import('../dev/DevLearningPaths')),
  flags: lazy(() => import('../dev/DevReports')),
  settings: lazy(() => import('../dev/DevSettings')),
  logs: lazy(() => import('../dev/DevLogs')),
  merch: lazy(() => import('../dev/DevMerch')),
} satisfies Record<AdminSection, ComponentType>;

export default function AdminPage() {
  return <DevAccess>{lock => <AdminWorkspace lock={lock} />}</DevAccess>;
}

function AdminWorkspace({ lock }: { lock: () => void }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { mode, toggle } = useColorMode();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const requested = pathname.split('/')[2] || 'users';
  // A section change closes the phone menu.
  useEffect(() => { setMenuOpen(false); }, [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      menuButton.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);
  if (!isAdminSection(requested)) return <Navigate to="/admin" replace />;
  const active = requested;
  const Part = PARTS[active];
  const label = (section: AdminSection) => t(('admin.' + section) as TranslationKey);
  const link = (section: AdminSection) => <Link key={section} to={adminPath(section)} aria-current={active === section ? 'page' : undefined}>{label(section)}</Link>;

  return <div className="admin-shell">
    <aside className="admin-sidebar" aria-label={t('admin.navigation')}>
      <div className="admin-sidebar-top">
        <Link className="admin-brand" to="/admin" aria-label={t('admin.title')}><BrandLogo /><span>{t('admin.administration')}</span></Link>
        <button ref={menuButton} type="button" className="admin-menu-toggle" aria-expanded={menuOpen} aria-controls="admin-navigation" onClick={() => setMenuOpen(open => !open)}>
          <span>{t('admin.menu')}</span><span className="admin-menu-current">{label(active)}</span>
        </button>
      </div>
      <nav id="admin-navigation" aria-label={t('admin.sections')} data-open={menuOpen}>
        {ADMIN_GROUPS.map(group => 'collapsible' in group
          ? <details key={group.label} className="admin-nav-group" open={(group.sections as readonly AdminSection[]).includes(active) || undefined}>
              <summary>{t(group.label)}</summary>
              <div>{group.sections.map(link)}</div>
            </details>
          : <div key={group.label} className="admin-nav-group" role="group" aria-labelledby={'admin-group-' + group.label}>
              <span className="admin-nav-label" id={'admin-group-' + group.label}>{t(group.label)}</span>
              {group.sections.map(link)}
            </div>)}
      </nav>
      <div className="admin-sidebar-footer" data-open={menuOpen}>
        <span className="admin-account">{user?.email}</span>
        <Link to="/">{t('admin.openApp')} ↗</Link>
        <div className="admin-sidebar-actions">
          <Button variant="ghost" label={mode === 'dark' ? t('admin.light') : t('admin.dark')} onClick={toggle} />
          <Button variant="ghost" label={t('admin.lock')} onClick={lock} />
        </div>
      </div>
    </aside>
    <section className="admin-main" aria-label={t('admin.workspace')}>
      <PageHeader title={label(active)} lead={t(('admin.' + active + '.lead') as TranslationKey)} />
      <div className="dev-workspace">
        <Suspense fallback={<LoadingScreen label={t('admin.loading')} />}><Part /></Suspense>
      </div>
    </section>
  </div>;
}
