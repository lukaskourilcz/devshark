import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import LoadingScreen from '../LoadingScreen';
import DevLogin from './DevLogin';
import { verifyAdminAccess } from '../../lib/devApi';
import { useAuth } from '../../lib/auth';
import { Button } from '@astryxdesign/core/Button';
import { StatePanel } from '../ui/StatePanel';
import { friendlyError } from '../../lib/api';
import { useLanguage } from '../../i18n/LanguageContext';
import { operationsEn } from '../../i18n/translations.operationsRoute';

type Phase = 'checking' | 'login' | 'ready' | 'error';

/**
 * Entry point for the authenticated /dev admin console. The API checks the
 * current Supabase session.
 *
 * The access check belongs to the account that passed it. When the signed-in
 * account changes (a sign-out, or another account signing in) the check runs
 * again from the start, so the console never stays open, showing questions,
 * sign-in emails and shipping addresses, for someone who is not an admin.
 */
export default function DevAccess({ children }: { children: (lock: () => void) => ReactNode }) {
  const { user, isLoading } = useAuth();
  useEffect(() => {
    // Older admin tabs kept a retired credential here until the tab closed.
    try { sessionStorage.removeItem('devquiz:dev-password'); } catch { /* storage may be disabled */ }
  }, []);
  if (isLoading) return <LoadingScreen label="Checking access…" />;
  return <AccountAccess key={user?.id ?? 'signed-out'}>{children}</AccountAccess>;
}

function AccountAccess({ children }: { children: (lock: () => void) => ReactNode }) {
  const queryClient = useQueryClient();
  const { t } = useLanguage(operationsEn);
  const [error, setError] = useState('');
  useEffect(() => () => { queryClient.removeQueries({ queryKey: ['admin'] }); }, [queryClient]);
  const [phase, setPhase] = useState<Phase>('checking');

  useEffect(() => {
    if (phase !== 'checking') return;
    let active = true;
    verifyAdminAccess()
      .then((ok) => active && setPhase(ok ? 'ready' : 'login'))
      .catch(error => { if (active) { setError(friendlyError(error)); setPhase('error'); } });
    return () => {
      active = false;
    };
  }, [phase]);

  if (phase === 'checking') return <LoadingScreen label="Checking access…" />;
  if (phase === 'error') return <StatePanel level={1} title={t('admin.accessFailed')} body={error}><Button variant="secondary" label={t('admin.retry')} onClick={() => setPhase('checking')} /></StatePanel>;
  if (phase === 'login') return <DevLogin onSuccess={() => setPhase('ready')} />;
  return children(() => {
    queryClient.removeQueries({ queryKey: ['admin'] });
    setPhase('login');
  });
}

