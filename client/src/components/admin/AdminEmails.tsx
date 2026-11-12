import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useLanguage } from '../../i18n/LanguageContext';
import { adminEmailsKey, listAdminEmails, saveAdminEmail } from '../../lib/adminDirectory';
import { friendlyError } from '../../lib/api';
import { StatePanel } from '../ui/StatePanel';
import { AdminDisclosure } from './AdminDisclosure';
import type { AdminEmails as AdminEmailsData } from '../../../../shared/admin-directory';
import type { EmailDocument } from '../../../../shared/email-document';
import {
  EMAIL_SAMPLE_VARIABLES,
  EMAIL_TEMPLATE_DEFINITIONS,
  emailTemplateDefinition,
  emailTemplateProblem,
  renderEmailTemplate,
  sampleEmailAction,
  type AuthSyncResult,
  type AuthSyncStatus,
  type EmailTemplateId,
} from '../../../../shared/email-templates';

const EmailRichTextEditor = lazy(() => import('./EmailRichTextEditor'));

type Feedback = { status: 'success' | 'error' | 'warning'; title: string } | null;

/**
 * The email editor (owner, 12 November 2026, after the NAVIGYM administration): pick a template, edit
 * its subject and text, see the branded result with sample values, save, and send one test email.
 */
export default function AdminEmails() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: adminEmailsKey, queryFn: listAdminEmails, staleTime: 60_000 });
  const [selectedId, setSelectedId] = useState<EmailTemplateId>('signup_confirmation');
  const stored = query.data?.templates[selectedId];
  const [subject, setSubject] = useState('');
  const [document, setDocument] = useState<EmailDocument | null>(null);
  // What the editor shows when it is (re)loaded: a new object makes it replace its content.
  const [seed, setSeed] = useState<EmailDocument | null>(null);
  const [testTo, setTestTo] = useState('');
  const [saveFeedback, setSaveFeedback] = useState<Feedback>(null);
  const [testFeedback, setTestFeedback] = useState<Feedback>(null);

  // Load the selected template, and again after a save or reset replaced it.
  useEffect(() => {
    if (!stored) return;
    setSubject(stored.subject);
    setDocument(stored.document);
    setSeed({ ...stored.document });
  }, [stored]);
  useEffect(() => { setSaveFeedback(null); setTestFeedback(null); }, [selectedId]);

  const draft = document ? { subject, document } : null;
  const dirty = !!stored && !!draft && (draft.subject !== stored.subject || JSON.stringify(draft.document) !== JSON.stringify(stored.document));
  const problem = draft ? emailTemplateProblem(selectedId, draft) : null;
  const preview = useMemo(() => document ? renderEmailTemplate({ subject, document }, EMAIL_SAMPLE_VARIABLES, sampleEmailAction(selectedId)) : null,
    [subject, document, selectedId]);

  const syncMessage = (sync: AuthSyncResult | null): Feedback => {
    if (!sync || sync.synced) return { status: 'success', title: sync ? t('admin.emails.savedSynced') : t('admin.emails.saved') };
    return { status: 'warning', title: sync.reason === 'not_configured' ? t('admin.emails.savedNoToken')
      : t('admin.emails.savedSyncFailed').replace('{status}', sync.status ? 'HTTP ' + sync.status : t('admin.emails.noResponse')) };
  };
  const replace = (template: AdminEmailsData['templates'][EmailTemplateId]) =>
    queryClient.setQueryData<AdminEmailsData>(adminEmailsKey, old => old ? { ...old, templates: { ...old.templates, [selectedId]: template } } : old);

  const save = useMutation({
    mutationFn: () => saveAdminEmail({ action: 'save', id: selectedId, subject, document: document! }),
    onMutate: () => setSaveFeedback(null),
    onSuccess: result => { if ('template' in result) { replace(result.template); setSaveFeedback(syncMessage(result.authSync)); } },
    onError: error => setSaveFeedback({ status: 'error', title: friendlyError(error) }),
  });
  const reset = useMutation({
    mutationFn: () => saveAdminEmail({ action: 'reset', id: selectedId }),
    onMutate: () => setSaveFeedback(null),
    onSuccess: result => {
      if (!('template' in result)) return;
      replace(result.template);
      const message = syncMessage(result.authSync);
      setSaveFeedback(message?.status === 'success' ? { status: 'success', title: t('admin.emails.resetDone') } : message);
    },
    onError: error => setSaveFeedback({ status: 'error', title: friendlyError(error) }),
  });
  const test = useMutation({
    mutationFn: () => saveAdminEmail({ action: 'test', id: selectedId, to: testTo.trim() }),
    onMutate: () => setTestFeedback(null),
    onSuccess: () => setTestFeedback({ status: 'success', title: t('admin.emails.testSent') }),
    onError: error => setTestFeedback({ status: 'error', title: friendlyError(error) }),
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

    <div className="admin-email-tabs" role="tablist" aria-label={t('admin.emails.templates')}>
      {EMAIL_TEMPLATE_DEFINITIONS.map(template => <button key={template.id} type="button" role="tab" id={'email-tab-' + template.id}
        aria-selected={selectedId === template.id} aria-controls="email-template-panel" className="admin-email-tab"
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
        <form onSubmit={event => { event.preventDefault(); if (!problem && dirty) save.mutate(); }}>
          <TextInput label={t('admin.emails.subject')} value={subject} onChange={setSubject} width="100%" />
          <p className="admin-email-label" id="email-body-label">{t('admin.emails.body')}</p>
          {seed ? <Suspense fallback={<p role="status">{t('admin.emails.editorLoading')}</p>}>
            <EmailRichTextEditor initialDocument={seed} onChange={setDocument} labelId="email-body-label" helpId="email-body-help" />
          </Suspense> : null}
          <p className="admin-muted admin-email-help" id="email-body-help">{t('admin.emails.bodyHelp')}</p>
          {problem && dirty ? <Banner status="warning" title={problem} /> : null}
          {saveFeedback ? <Banner status={saveFeedback.status} title={saveFeedback.title} /> : null}
          <div className="admin-email-actions">
            <Button type="submit" variant="primary" label={save.isPending ? t('admin.emails.saving') : t('admin.emails.save')} isDisabled={!dirty || !!problem || busy} />
            {dirty ? <Button variant="secondary" label={t('admin.emails.discard')} onClick={() => { setSubject(stored!.subject); setDocument(stored!.document); setSeed({ ...stored!.document }); }} isDisabled={busy} /> : null}
            {stored?.custom ? <Button variant="secondary" label={t('admin.emails.reset')} onClick={() => reset.mutate()} isDisabled={busy} /> : null}
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
        <form className="admin-email-test" onSubmit={event => { event.preventDefault(); if (testTo.trim()) test.mutate(); }}>
          <TextInput type="email" label={t('admin.emails.testTo')} description={t('admin.emails.testHelp')} value={testTo} onChange={setTestTo} placeholder="you@example.com" width="100%" />
          {testFeedback ? <Banner status={testFeedback.status} title={testFeedback.title} /> : null}
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
