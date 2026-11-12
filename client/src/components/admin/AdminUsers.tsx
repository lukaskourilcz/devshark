import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@astryxdesign/core/Button';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Banner } from '@astryxdesign/core/Banner';
import { useLanguage } from '../../i18n/LanguageContext';
import { adminDirectoryKey, listAdminUsers } from '../../lib/adminDirectory';
import { friendlyError } from '../../lib/api';
import { StatePanel } from '../ui/StatePanel';
import { planText } from '../PlanLine';
import { AdminDisclosure } from './AdminDisclosure';

export function adminDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(date) : '—';
}

export default function AdminUsers() {
  const { t } = useLanguage();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const query = useQuery({ queryKey: adminDirectoryKey(page), queryFn: () => listAdminUsers(page), staleTime: 30_000 });
  const needle = search.trim().toLowerCase();
  const users = query.data?.users.filter(user => !needle || [user.email, user.name, user.id, ...user.vouchers.flatMap(v => [v.hint, v.note])].some(value => value?.toLowerCase().includes(needle))) ?? [];
  return <div className="admin-section" data-testid="admin-users">
    <div className="admin-toolbar"><TextInput label={t('admin.users.search')} value={search} onChange={setSearch} placeholder={t('admin.users.searchHint')} /><Button variant="secondary" label={t('admin.refresh')} onClick={() => void query.refetch()} isDisabled={query.isFetching} /></div>
    {query.isPending ? <p role="status">{t('admin.users.loading')}</p> : query.isError ? <StatePanel level={2} title={t('admin.unavailable')} body={friendlyError(query.error)}><Button variant="secondary" label={t('admin.retry')} onClick={() => void query.refetch()} /></StatePanel> : <>
      <p className="admin-muted" role="status">{t('admin.users.count', { shown: users.length, total: query.data.total })}</p>
      {query.data.voucherHistoryPartial && <Banner status="warning" title={t('admin.users.partial')} />}
      {users.length === 0 ? <StatePanel level={2} title={t('admin.users.empty')} body={search ? t('admin.users.noMatch') : t('admin.users.emptyBody')} /> : <div className="admin-table-scroll" role="region" aria-label={t('admin.users.table')} tabIndex={0}><table className="admin-table"><thead><tr>
        <th scope="col">{t('admin.users.account')}</th><th scope="col">{t('admin.users.premium')}</th><th scope="col">{t('admin.users.lastSignIn')}</th>
      </tr></thead><tbody>{users.map(user => <tr key={user.id}>
        <th scope="row">
          <span className="admin-user-name">{user.name || user.email || user.id}</span>
          {user.name && user.email ? <span className="admin-muted">{user.email}</span> : null}
          <AdminDisclosure className="admin-disclosure-quiet" summary={t('admin.details')}>
            <dl className="admin-facts">
              <div><dt>{t('admin.users.emailStatus')}</dt><dd>{user.emailConfirmed ? t('admin.users.verified') : t('admin.users.unverified')}</dd></div>
              <div><dt>{t('admin.users.joined')}</dt><dd>{adminDate(user.createdAt)}</dd></div>
              <div><dt>{t('admin.users.signInWith')}</dt><dd>{user.providers.join(', ') || '—'}</dd></div>
              <div><dt>{t('admin.users.id')}</dt><dd className="admin-user-id">{user.id}</dd></div>
              <div><dt>{t('admin.users.vouchers')}</dt><dd>{user.vouchers.length ? <ul className="admin-user-vouchers">{user.vouchers.map(voucher => <li key={voucher.voucherId}><strong>{voucher.hint}…</strong> {voucher.note}<span className="admin-muted">{t('admin.users.redeemed')}: {adminDate(voucher.redeemedAt)} · {t('admin.users.validUntil')}: {voucher.validUntil ? adminDate(voucher.validUntil) : t('admin.users.noEnd')}{voucher.status !== 'active' ? ' · ' + t('admin.users.revoked') : ''}</span></li>)}</ul> : t('admin.users.noVoucher')}</dd></div>
            </dl>
          </AdminDisclosure>
        </th>
        <td><span className="admin-plan" data-premium={user.plan.tier === 'premium'}>{planText(user.plan, t)}</span>{user.vouchers.length ? <span className="admin-muted">{t('admin.users.voucherCount', { count: user.vouchers.length })}</span> : null}</td>
        <td>{user.lastSignInAt ? adminDate(user.lastSignInAt) : <span className="admin-muted">{t('admin.users.never')}</span>}</td>
      </tr>)}</tbody></table></div>}
      <nav className="admin-pagination" aria-label={t('admin.pagination')}><Button variant="secondary" label={t('admin.previous')} isDisabled={page === 1} onClick={() => { setPage(p => p - 1); setSearch(''); }} /><span>{t('admin.page', { page })}</span><Button variant="secondary" label={t('admin.next')} isDisabled={!query.data.hasNextPage} onClick={() => { setPage(p => p + 1); setSearch(''); }} /></nav>
    </>}
  </div>;
}
