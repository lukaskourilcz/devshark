import { lazy, Suspense, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useLanguage } from '../../i18n/LanguageContext';
import { operationsEn } from '../../i18n/translations.operationsRoute';
import { adminEmailsKey, listAdminEmails, saveAdminEmail } from '../../lib/adminDirectory';
import { friendlyError } from '../../lib/api';
import { accountEpoch } from '../../lib/accountData';
import { StatePanel } from '../ui/StatePanel';
import { AdminDisclosure } from './AdminDisclosure';
import type { AdminEmails as AdminEmailsData } from '../../../../shared/admin-directory';
import {
  EMAIL_SAMPLE_VARIABLES,
  EMAIL_TEMPLATE_DEFINITIONS,
  emailTemplateDefinition,
  emailTemplateProblem,
  renderEmailTemplate,
  sampleEmailAction,
  type AuthSyncResult,
  type AuthSyncStatus,
  type EmailTemplate,
  type EmailTemplateId,
} from '../../../../shared/email-templates';

const EmailRichTextEditor = lazy(() => import('./EmailRichTextEditor'));

type Feedback = { status: 'success' | 'error' | 'warning'; title: string };
type TemplateEdit = { id: EmailTemplateId; draft: EmailTemplate };

/**
 * The email editor (owner, 12 November 2026, after the NAVIGYM administration): pick a template, edit
 * its subject and text, see the branded result with sample values, save, and send one test email.
 */
export default function AdminEmails() {
  const { t } = useLanguage(operationsEn);
  const queryClient = useQueryClient();
  const [openedEpoch] = useState(accountEpoch);
  const query = useQuery({ queryKey: adminEmailsKey, queryFn: listAdminEmails, staleTime: 60_000 });
  const [selectedId, setSelectedId] = useState<EmailTemplateId>('signup_confirmation');
  const stored = query.data?.templates[selectedId];
  const [edits, setEdits] = useState<Partial<Record<EmailTemplateId, EmailTemplate>>>({});
  const draft = edits[selectedId] ?? stored;
  const subject = draft?.subject ?? '';
  const document = draft?.document;
  const [testTo, setTestTo] = useState('');
  const [saveFeedback, setSaveFeedback] = useState<(Feedback & { id: EmailTemplateId }) | null>(null);
  const [testFeedback, setTestFeedback] = useState<(Feedback & { id: EmailTemplateId }) | null>(null);

  function change(patch: Partial<EmailTemplate>) {
    if (!stored) return;
    setEdits(current => ({ ...current, [selectedId]: { ...(current[selectedId] ?? stored), ...patch } }));
    setSaveFeedback(null);
  }
  // Typing after Save creates a different draft. Its earlier acknowledgement
  // can update the stored template, but must leave those newer edits in place.
  function discard(id: EmailTemplateId, expected: EmailTemplate | undefined) {
    setEdits(current => {
      if (!current[id] || current[id] !== expected) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  const dirty = !!stored && !!draft && (draft.subject !== stored.subject || JSON.stringify(draft.document) !== JSON.stringify(stored.document));
  const problem = draft ? emailTemplateProblem(selectedId, draft) : null;
  const preview = useMemo(() => document ? renderEmailTemplate({ subject, document }, EMAIL_SAMPLE_VARIABLES, sampleEmailAction(selectedId)) : null,
    [subject, document, selectedId]);

  const syncMessage = (sync: AuthSyncResult | null): Feedback => {
    if (!sync || sync.synced) return { status: 'success', title: sync ? t('admin.emails.savedSynced') : t('admin.emails.saved') };
    return { status: 'warning', title: sync.reason === 'not_configured' ? t('admin.emails.savedNoToken')
      : t('admin.emails.savedSyncFailed').replace('{status}', sync.status ? 'HTTP ' + sync.status : t('admin.emails.noResponse')) };
  };
  const replace = (id: EmailTemplateId, template: AdminEmailsData['templates'][EmailTemplateId]) => {
    if (openedEpoch !== accountEpoch()) return;
    queryClient.setQueryData<AdminEmailsData>(adminEmailsKey, old => old ? { ...old, templates: { ...old.templates, [id]: template } } : old);
  };

  const save = useMutation({
    mutationFn: ({ id, draft }: TemplateEdit) => saveAdminEmail({ action: 'save', id, subject: draft.subject, document: draft.document }),
    onMutate: () => setSaveFeedback(null),
    onSuccess: (result, { id, draft }) => {
      if (!('template' in result)) return;
      replace(id, result.template);
      discard(id, draft);
      setSaveFeedback({ id, ...syncMessage(result.authSync) });
    },
    onError: (error, { id }) => setSaveFeedback({ id, status: 'error', title: friendlyError(error) }),
  });
  const reset = useMutation({
    mutationFn: ({ id }: { id: EmailTemplateId; edit?: EmailTemplate }) => saveAdminEmail({ action: 'reset', id }),
    onMutate: () => setSaveFeedback(null),
    onSuccess: (result, { id, edit }) => {
      if (!('template' in result)) return;
      replace(id, result.template);
      discard(id, edit);
      const message = syncMessage(result.authSync);
      setSaveFeedback({ id, ...message, title: message.status === 'success' ? t('admin.emails.resetDone') : message.title });
    },
    onError: (error, { id }) => setSaveFeedback({ id, status: 'error', title: friendlyError(error) }),
  });
  const test = useMutation({
    mutationFn: ({ id, to }: { id: EmailTemplateId; to: string }) => saveAdminEmail({ action: 'test', id, to }),
    onMutate: () => setTestFeedback(null),
    onSuccess: (_result, { id }) => setTestFeedback({ id, status: 'success', title: t('admin.emails.testSent') }),
    onError: (error, { id }) => setTestFeedback({ id, status: 'error', title: friendlyError(error) }),
  });

  if (query.isPending) return <p role="status">{t('admin.emails.loading')}</p>;
  if (query.isError) return <StatePanel level={2} title={t('admin.unavailable')} body={friendlyError(query.error)}><Button variant="secondary" label={t('admin.retry')} onClick={() => void query.refetch()} /></StatePanel>;
  const data = query.data;
  const definition = emailTemplateDefinition(selectedId);
  const busy = save.isPending || reset.isPending;

  return <div className="admin-section" data-testid="admin-emails">
    <AdminDisclosure testId="email-delivery" summary={<span className="admin-email-status">{t('admin.emails.delivery')}: <span data-ok={data.deliveryConfigured}>{data.deliveryConfigured ? t('admin.emails.ready') : t('admin.emails.notConfigured')}</span></span>}>
      <dl className="admin-facts">
        <div><dt>{t('admin.emails.sender')}</dt><dd>{data.sender}</dd></div>
        <div><dt>{t('admin.emails.replyTo')}</dt><dd>{data.replyTo}</dd></div>
        <div><dt>{t('admin.emails.billing')}</dt><dd>{data.billingEnabled ? t('admin.emails.enabled') : t('admin.emails.disabled')}</dd></div>
        <div><dt>{t('admin.emails.authSync')}</dt><dd>{authSyncLabel(data.authSync, t)}</dd></div>
      </dl>
      {data.authTemplatesUrl ? <a className="admin-external-link" href={data.authTemplatesUrl} target="_blank" rel="noreferrer">{t('admin.emails.manageAuth')} ↗</a> : null}
    </AdminDisclosure>

    <div className="admin-email-tabs" role="tablist" aria-label={t('admin.emails.templates')} onKeyDown={event => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const tabs = EMAIL_TEMPLATE_DEFINITIONS;
      const index = tabs.findIndex(template => template.id === selectedId);
      let next: number;
      switch (event.key) {
        case 'ArrowLeft': next = (index + tabs.length - 1) % tabs.length; break;
        case 'ArrowRight': next = (index + 1) % tabs.length; break;
        case 'Home': next = 0; break;
        case 'End': next = tabs.length - 1; break;
        default: return;
      }
      event.preventDefault();
      setSelectedId(tabs[next].id);
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
    }}>
      {EMAIL_TEMPLATE_DEFINITIONS.map(template => <button key={template.id} type="button" role="tab" id={'email-tab-' + template.id}
        tabIndex={selectedId === template.id ? 0 : -1} aria-selected={selectedId === template.id} aria-controls="email-template-panel" className="admin-email-tab"
        onClick={() => setSelectedId(template.id)}>{template.label}{data.templates[template.id].custom ? <span className="admin-email-tab-mark"> · {t('admin.emails.edited')}</span> : null}</button>)}
    </div>

    <div className="admin-email-workspace" role="tabpanel" id="email-template-panel" aria-labelledby={'email-tab-' + selectedId}>
      <div className="admin-email-form">
        <AdminDisclosure className="admin-disclosure-quiet" summary={t('admin.emails.about')}>
          <p className="admin-muted">{definition.description}</p>
          <p className="admin-muted">{t('admin.emails.variables')} {definition.variables.map((variable, index) =>
            <span key={variable}><code>{variable}</code>{index < definition.variables.length - 1 ? ', ' : '.'}</span>)}
            {definition.required.length ? ' ' + t('admin.emails.required').replace('{variables}', definition.required.join(', ')) : ''}</p>
          {definition.delivery === 'supabase_auth' ? <p className="admin-muted">{authTemplateNote(selectedId, data.authSync, t)}</p> : null}
        </AdminDisclosure>
        <form onSubmit={event => { event.preventDefault(); if (draft && !problem && dirty && !busy) save.mutate({ id: selectedId, draft }); }}>
          <TextInput label={t('admin.emails.subject')} value={subject} onChange={value => change({ subject: value })} width="100%" />
          <p className="admin-email-label" id="email-body-label">{t('admin.emails.body')}</p>
          {document ? <Suspense fallback={<p role="status">{t('admin.emails.editorLoading')}</p>}>
            <EmailRichTextEditor key={selectedId} initialDocument={document} onChange={value => change({ document: value })} labelId="email-body-label" helpId="email-body-help" />
          </Suspense> : null}
          <p className="admin-muted admin-email-help" id="email-body-help">{t('admin.emails.bodyHelp')}</p>
          {problem && dirty ? <Banner status="warning" title={problem} /> : null}
          {saveFeedback?.id === selectedId ? <Banner status={saveFeedback.status} title={saveFeedback.title} /> : null}
          <div className="admin-email-actions">
            <Button type="submit" variant="primary" label={save.isPending ? t('admin.emails.saving') : t('admin.emails.save')} isDisabled={!dirty || !!problem || busy} />
            {dirty ? <Button variant="secondary" label={t('admin.emails.discard')} onClick={() => discard(selectedId, edits[selectedId])} isDisabled={busy} /> : null}
            {stored?.custom ? <Button variant="secondary" label={t('admin.emails.reset')} onClick={() => reset.mutate({ id: selectedId, edit: edits[selectedId] })} isDisabled={busy} /> : null}
          </div>
        </form>
      </div>

      <div className="admin-email-preview-pane">
        <h3>{t('admin.emails.preview')}</h3>
        <p className="admin-muted">{t('admin.emails.previewNote')}</p>
        {preview ? <>
          <p className="admin-email-preview-subject">{preview.subject}</p>
          <iframe className="admin-email-frame" title={t('admin.emails.preview')} sandbox="" srcDoc={preview.html} />
        </> : null}
        <form className="admin-email-test" onSubmit={event => { event.preventDefault(); if (testTo.trim() && !test.isPending) test.mutate({ id: selectedId, to: testTo.trim() }); }}>
          <TextInput type="email" label={t('admin.emails.testTo')} description={t('admin.emails.testHelp')} value={testTo} onChange={setTestTo} placeholder="you@example.com" width="100%" />
          {testFeedback?.id === selectedId ? <Banner status={testFeedback.status} title={testFeedback.title} /> : null}
          <Button type="submit" variant="secondary" label={test.isPending ? t('admin.emails.sending') : t('admin.emails.sendTest')} isDisabled={!testTo.trim() || test.isPending || !data.deliveryConfigured} />
          {!data.deliveryConfigured ? <p className="admin-muted">{t('admin.emails.testNeedsKey')}</p> : null}
        </form>
      </div>
    </div>
  </div>;
}

type T = ReturnType<typeof useLanguage>['t'];

function authSyncLabel(status: AuthSyncStatus, t: T): string {
  if (!status.configured) return t('admin.emails.syncNoToken');
  if (!status.ok) return t('admin.emails.syncRejected').replace('{status}', status.status ? 'HTTP ' + status.status : t('admin.emails.noResponse'));
  return t('admin.emails.syncWorking');
}

function authTemplateNote(id: EmailTemplateId, status: AuthSyncStatus, t: T): string {
  if (!status.configured) return t('admin.emails.authNoteNoToken');
  if (!status.ok) return t('admin.emails.authNoteRejected');
  return status.synced[id as keyof typeof status.synced] ? t('admin.emails.authNoteSynced') : t('admin.emails.authNoteNotSynced');
}
