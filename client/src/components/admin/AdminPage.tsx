import { Suspense } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Button } from '@astryxdesign/core/Button';
import BrandLogo from '../BrandLogo';
import DevAccess from '../dev/DevAccess';
import { PageHeader } from '../ui/PageHeader';
import LoadingScreen from '../LoadingScreen';
import { useAuth } from '../../lib/auth';
import { useColorMode } from '../../theme/ColorModeContext';
import { useLanguage } from '../../i18n/LanguageContext';
import { lazyShellPart } from '../../lib/routeRecovery';
import AdminUsers from './AdminUsers';
import AdminEmails from './AdminEmails';
import './AdminPage.css';

const Vouchers = lazyShellPart(() => import('../dev/DevVouchers'));
const SECTIONS = ['users', 'vouchers', 'emails'] as const;
const COPY = { users: ['admin.users', 'admin.users.lead'], vouchers: ['admin.vouchers', 'admin.vouchers.lead'], emails: ['admin.emails', 'admin.emails.lead'] } as const;

export default function AdminPage() {
  return <DevAccess>{lock => <AdminWorkspace lock={lock} />}</DevAccess>;
}

function AdminWorkspace({ lock }: { lock: () => void }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { mode, toggle } = useColorMode();
  const { pathname } = useLocation();
  const requested = pathname.split('/')[2] || 'users';
  if (!(SECTIONS as readonly string[]).includes(requested)) return <Navigate to="/admin" replace />;
  const active = requested as typeof SECTIONS[number];
  return <div className="admin-shell">
    <aside className="admin-sidebar" aria-label={t('admin.navigation')}>
      <Link className="admin-brand" to="/admin" aria-label={t('admin.title')}><BrandLogo /><span>{t('admin.administration')}</span></Link>
      <nav aria-label={t('admin.sections')}>{SECTIONS.map(item => <Link key={item} to={item === 'users' ? '/admin' : '/admin/' + item} aria-current={active === item ? 'page' : undefined}>{t(COPY[item][0])}</Link>)}</nav>
      <div className="admin-sidebar-footer"><span className="admin-account">{user?.email}</span><Link to="/">{t('admin.openApp')}</Link><Button variant="ghost" label={mode === 'dark' ? t('admin.light') : t('admin.dark')} onClick={toggle} /><Button variant="ghost" label={t('admin.lock')} onClick={lock} /></div>
    </aside>
    <section className="admin-main" aria-label={t('admin.workspace')}>
      <PageHeader title={t(COPY[active][0])} lead={t(COPY[active][1])} />
      {active === 'users' ? <AdminUsers /> : active === 'emails' ? <AdminEmails /> : <Suspense fallback={<LoadingScreen label={t('dev.vouchers.loading')} />}><Vouchers /></Suspense>}
    </section>
  </div>;
}
