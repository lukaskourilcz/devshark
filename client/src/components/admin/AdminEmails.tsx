import { useQuery } from '@tanstack/react-query';
import { Button } from '@astryxdesign/core/Button';
import { useLanguage } from '../../i18n/LanguageContext';
import { adminEmailsKey, listAdminEmails } from '../../lib/adminDirectory';
import { friendlyError } from '../../lib/api';
import { StatePanel } from '../ui/StatePanel';

export default function AdminEmails() {
  const { t } = useLanguage();
  const query = useQuery({ queryKey: adminEmailsKey, queryFn: listAdminEmails, staleTime: 60_000 });
  if (query.isPending) return <p role="status">{t('admin.emails.loading')}</p>;
  if (query.isError) return <StatePanel level={2} title={t('admin.unavailable')} body={friendlyError(query.error)}><Button variant="secondary" label={t('admin.retry')} onClick={() => void query.refetch()} /></StatePanel>;
  return <div className="admin-section" data-testid="admin-emails">
    <section className="admin-email-settings"><h2>{t('admin.emails.account')}</h2><p>{t('admin.emails.accountBody')}</p>{query.data.authTemplatesUrl ? <a className="admin-external-link" href={query.data.authTemplatesUrl} target="_blank" rel="noreferrer">{t('admin.emails.manageAuth')} ↗</a> : <p>{t('admin.emails.noAuthLink')}</p>}</section>
    <section className="admin-email-settings"><h2>{t('admin.emails.transactional')}</h2><dl><div><dt>{t('admin.emails.delivery')}</dt><dd>{query.data.billingEmailConfigured ? t('admin.emails.configured') : t('admin.emails.notConfigured')}</dd></div><div><dt>{t('admin.emails.sender')}</dt><dd>{query.data.sender || t('admin.emails.notConfigured')}</dd></div><div><dt>{t('admin.emails.billing')}</dt><dd>{query.data.billingEnabled ? t('admin.emails.enabled') : t('admin.emails.disabled')}</dd></div></dl><p className="admin-muted">{t('admin.emails.previewNote')}</p></section>
    <div className="admin-email-list">{query.data.previews.map(preview => <details key={preview.id} className="admin-email-preview"><summary>{preview.subject}</summary><pre>{preview.text}</pre></details>)}</div>
    <Button variant="secondary" label={t('admin.refresh')} onClick={() => void query.refetch()} isDisabled={query.isFetching} />
  </div>;
}
