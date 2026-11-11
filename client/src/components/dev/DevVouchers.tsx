// /dev → Vouchers (migration 045): the codes that open Premium.
//
// Create one (a note, how long Premium lasts, how many accounts may redeem
// it, an optional last day and an optional custom code), copy the code from
// the one answer that ever carries it, and watch or revoke the vouchers
// already made. The list shows a code's first four characters only: the
// database keeps its SHA-256 and nothing else. Revoking stops new
// redemptions; Premium a voucher already opened stays until its end, and an
// admin ends one grant with op=entitlements.
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { FieldLabel, FieldStatus } from '@astryxdesign/core/Field';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { TextInput } from '@astryxdesign/core/TextInput';
import ErrorRetry from '../ErrorRetry';
import { AppToast } from '../ui/AppToast';
import { ApiError, friendlyError } from '../../lib/api';
import { useLanguage } from '../../i18n/LanguageContext';
import type { TranslationKey } from '../../i18n/translations';
import { createVoucher, listVouchers, revokeVoucher, updateVoucherLimit, type VoucherInput } from '../../lib/devApi';
import { normalizeVoucherCode, type AdminVoucher, type CreatedVoucher } from '../../../../shared/vouchers';
import { Section, captionStyle } from './DevSettings';

const VOUCHERS_KEY = ['admin', 'vouchers'] as const;
const DAY_CHOICES = [
  { value: '30', key: 'dev.vouchers.days30' },
  { value: '90', key: 'dev.vouchers.days90' },
  { value: '365', key: 'dev.vouchers.days365' },
  { value: 'none', key: 'dev.vouchers.daysNone' },
] as const satisfies readonly { value: string; key: TranslationKey }[];
type DayChoice = (typeof DAY_CHOICES)[number]['value'];

/** A day in the browser's own calendar, as <input type="date"> writes it. */
const localDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

type FieldErrors = Partial<Record<'note' | 'uses' | 'until' | 'code', TranslationKey>>;

/** The form as the server's input, or the fields that stop it. The server
 * checks every value again. */
export function voucherInput(
  form: { note: string; days: DayChoice; uses: string; until: string; code: string },
  today: Date = new Date(),
): { input: VoucherInput } | { errors: FieldErrors } {
  const errors: FieldErrors = {};
  const note = form.note.trim();
  if (note.length === 0 || note.length > 500) errors.note = 'dev.vouchers.noteRequired';
  const uses = Number(form.uses.trim());
  if (form.uses.trim() === '' || !Number.isInteger(uses) || uses < 1 || uses > 10_000) errors.uses = 'dev.vouchers.usesInvalid';
  let redeemableUntil: string | null = null;
  if (form.until) {
    const last = new Date(today);
    last.setFullYear(last.getFullYear() + 5);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.until) || form.until < localDay(today) || form.until > localDay(last)) {
      errors.until = 'dev.vouchers.untilInvalid';
    } else {
      // The code works to the end of the chosen day, in the owner's time zone.
      redeemableUntil = new Date(`${form.until}T23:59:59`).toISOString();
    }
  }
  let code: string | null = null;
  if (form.code.trim()) {
    code = normalizeVoucherCode(form.code);
    if (!code) errors.code = 'dev.vouchers.customInvalid';
  }
  if (Object.keys(errors).length > 0) return { errors };
  return {
    input: { note, premiumDays: form.days === 'none' ? null : Number(form.days), maxRedemptions: uses, redeemableUntil, code },
  };
}

export default function DevVouchers() {
  const { t } = useLanguage();
  const [toast, setToast] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedVoucher | null>(null);
  return (
    <div style={{ maxWidth: 960 }}>
      <p style={{ ...captionStyle, marginTop: 0, marginBottom: 16, maxWidth: '68ch' }}>{t('dev.vouchers.intro')}</p>
      <CreateVoucher onCreated={setCreated} />
      {created && <CreatedCode created={created} onDone={() => setCreated(null)} />}
      <VoucherList onMessage={setToast} />
      <AppToast open={!!toast} onClose={() => setToast(null)} message={toast ?? ''} severity="info" autoHideDuration={3500} />
    </div>
  );
}

/* ── a new voucher ─────────────────────────────────────────────────────── */

function CreateVoucher({ onCreated }: { onCreated: (created: CreatedVoucher) => void }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [days, setDays] = useState<DayChoice>('30');
  const [uses, setUses] = useState('1');
  const [until, setUntil] = useState('');
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // `busy` reaches this handler only after a render, so a double click or a
  // held Enter created two vouchers and showed only the second code: the
  // first opened Premium with a code nobody could read again. The ref holds
  // from the first submit.
  const busyRef = useRef(false);
  const ids = { days: useId(), daysLabel: useId(), daysHint: useId(), until: useId(), untilHint: useId(), untilError: useId() };
  const today = new Date();
  const last = new Date(today);
  last.setFullYear(last.getFullYear() + 5);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busyRef.current) return;
    setFailure(null);
    const checked = voucherInput({ note, days, uses, until, code });
    if ('errors' in checked) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await createVoucher(checked.input);
      onCreated(result);
      setNote('');
      setCode('');
      setUntil('');
      setUses('1');
      await queryClient.invalidateQueries({ queryKey: VOUCHERS_KEY });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'voucher_exists') setErrors({ code: 'dev.vouchers.exists' });
      else if (error instanceof ApiError && error.code === 'migration_required') setFailure(t('dev.vouchers.migration'));
      else if (error instanceof ApiError && error.status === 400) setFailure(error.message);
      else setFailure(friendlyError(error));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const status = (key: keyof FieldErrors) => (errors[key] ? { type: 'error' as const, message: t(errors[key]!) } : undefined);

  return (
    <Section title={t('dev.vouchers.createTitle')}>
      <form className="dev-voucher-form" noValidate onSubmit={(event) => void submit(event)}>
        <TextInput
          label={t('dev.vouchers.note')}
          description={t('dev.vouchers.noteHint')}
          value={note}
          onChange={(value) => { setNote(value.slice(0, 500)); if (errors.note) setErrors({ ...errors, note: undefined }); }}
          status={status('note')}
          isRequired
          width="100%"
        />
        <div className="dev-voucher-form__row">
          <div className="dev-voucher-field">
            <FieldLabel
              isGroupLabel
              label={t('dev.vouchers.days')}
              inputID={ids.days}
              labelID={ids.daysLabel}
              description={t('dev.vouchers.daysHint')}
              descriptionID={ids.daysHint}
            />
            <SegmentedControl
              id={ids.days}
              value={days}
              onChange={(value) => setDays(value as DayChoice)}
              label={t('dev.vouchers.days')}
              aria-labelledby={ids.daysLabel}
              aria-describedby={ids.daysHint}
            >
              {DAY_CHOICES.map((choice) => <SegmentedControlItem key={choice.value} value={choice.value} label={t(choice.key)} />)}
            </SegmentedControl>
          </div>
          <TextInput
            label={t('dev.vouchers.uses')}
            description={t('dev.vouchers.usesHint')}
            value={uses}
            onChange={(value) => { setUses(value.replace(/[^\d]/g, '').slice(0, 5)); if (errors.uses) setErrors({ ...errors, uses: undefined }); }}
            status={status('uses')}
            width={180}
          />
        </div>
        <div className="dev-voucher-form__row">
          <div className="dev-voucher-field">
            <FieldLabel label={t('dev.vouchers.until')} inputID={ids.until} description={t('dev.vouchers.untilHint')} descriptionID={ids.untilHint} isOptional />
            <input
              id={ids.until}
              className="ss-input dev-voucher-date"
              type="date"
              value={until}
              min={localDay(today)}
              max={localDay(last)}
              onChange={(event) => { setUntil(event.target.value); if (errors.until) setErrors({ ...errors, until: undefined }); }}
              aria-describedby={errors.until ? `${ids.untilHint} ${ids.untilError}` : ids.untilHint}
              aria-invalid={errors.until ? true : undefined}
            />
            {errors.until && <FieldStatus id={ids.untilError} type="error" message={t(errors.until)} />}
          </div>
          <TextInput
            label={t('dev.vouchers.custom')}
            description={t('dev.vouchers.customHint')}
            isOptional
            value={code}
            onChange={(value) => { setCode(value.slice(0, 64)); if (errors.code) setErrors({ ...errors, code: undefined }); }}
            status={status('code')}
            width="min(100%, 360px)"
          />
        </div>
        {failure && <Banner status="error" title={failure} />}
        <div>
          <Button type="submit" variant="primary" label={t('dev.vouchers.create')} isLoading={busy} isDisabled={busy} />
        </div>
      </form>
    </Section>
  );
}

/* ── the code, once ────────────────────────────────────────────────────── */

function CreatedCode({ created, onDone }: { created: CreatedVoucher; onDone: () => void }) {
  const { t } = useLanguage();
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const heading = useRef<HTMLHeadingElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const statusId = useId();
  useEffect(() => {
    setCopy('idle');
    heading.current?.focus();
  }, [created]);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(created.code);
      setCopy('copied');
    } catch {
      // The clipboard refused: select the code so it can be copied by hand.
      setCopy('failed');
      field.current?.focus();
      field.current?.select();
    }
  };

  return (
    <section className="dev-voucher-created" aria-labelledby={`${fieldId}-title`}>
      <h3 ref={heading} id={`${fieldId}-title`} tabIndex={-1}>{t('dev.vouchers.createdTitle')}</h3>
      <p>{t('dev.vouchers.createdOnce')}</p>
      <FieldLabel label={t('dev.vouchers.codeLabel')} inputID={fieldId} />
      <div className="dev-voucher-created__field">
        <input
          ref={field}
          id={fieldId}
          className="ss-input dev-voucher-code"
          type="text"
          readOnly
          value={created.code}
          aria-describedby={statusId}
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button variant="primary" label={t('dev.vouchers.copy')} onClick={() => void copyCode()} />
      </div>
      <p id={statusId} className="dev-voucher-hint" role="status" aria-live="polite">
        {copy === 'copied' ? t('dev.vouchers.copied') : copy === 'failed' ? t('dev.vouchers.copyFailed') : ''}
      </p>
      <VoucherFacts voucher={created.voucher} />
      <div>
        <Button variant="secondary" label={t('dev.vouchers.done')} onClick={onDone} />
      </div>
    </section>
  );
}

/* ── the list ──────────────────────────────────────────────────────────── */

function VoucherFacts({ voucher }: { voucher: AdminVoucher }) {
  const { t } = useLanguage();
  const day = (iso: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
  return (
    <ul className="dev-voucher-facts">
      <li>{t('dev.vouchers.uses.value', { used: voucher.redeemedCount, max: voucher.maxRedemptions })}</li>
      <li>{voucher.premiumDays === null ? t('dev.vouchers.premium.noEnd') : t('dev.vouchers.premium.days', { days: voucher.premiumDays })}</li>
      <li>{voucher.redeemableUntil ? t('dev.vouchers.until.value', { date: day(voucher.redeemableUntil) }) : t('dev.vouchers.until.none')}</li>
      <li>{t('dev.vouchers.created', { date: day(voucher.createdAt) })}</li>
      {voucher.revokedAt && <li>{t('dev.vouchers.revokedOn', { date: day(voucher.revokedAt) })}</li>}
    </ul>
  );
}

function VoucherList({ onMessage }: { onMessage: (message: string) => void }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: VOUCHERS_KEY, queryFn: listVouchers });
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const revoke = async (voucher: AdminVoucher) => {
    setBusy(voucher.id);
    try {
      await revokeVoucher(voucher.id);
      onMessage(t('dev.vouchers.revoked', { hint: voucher.hint }));
      await queryClient.invalidateQueries({ queryKey: VOUCHERS_KEY });
    } catch (error) {
      onMessage(error instanceof ApiError && error.code === 'migration_required' ? t('dev.vouchers.migration') : friendlyError(error));
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  };

  const missing = query.error instanceof ApiError && query.error.code === 'migration_required';
  return (
    <Section title={t('dev.vouchers.listTitle')}>
      {query.isPending && <p style={captionStyle} role="status">{t('dev.vouchers.loading')}</p>}
      {missing && <Banner status="warning" title={t('dev.vouchers.migration')} />}
      {query.isError && !missing && <ErrorRetry message={friendlyError(query.error)} onRetry={() => void query.refetch()} />}
      {query.data && query.data.vouchers.length === 0 && <p style={captionStyle}>{t('dev.vouchers.empty')}</p>}
      {query.data && query.data.vouchers.length > 0 && (
        <ul className="dev-voucher-list">
          {query.data.vouchers.map((voucher) => (
            <li key={voucher.id} className="dev-voucher-row" data-state={voucher.state}>
              <div className="dev-voucher-row__head">
                <code className="dev-voucher-hint-code">{voucher.hint}…</code>
                <span className="dev-voucher-state">{t(`dev.vouchers.state.${voucher.state}` as TranslationKey)}</span>
                <span className="dev-voucher-note">{voucher.note}</span>
              </div>
              <VoucherFacts voucher={voucher} />
              {voucher.active && <VoucherLimit voucher={voucher} />}
              {voucher.state !== 'revoked' && (confirming === voucher.id ? (
                <div className="dev-voucher-confirm" role="group" aria-label={t('dev.vouchers.revoke')}>
                  <p>{t('dev.vouchers.revokeConfirm', { hint: voucher.hint })}</p>
                  <div className="dev-voucher-confirm__actions">
                    <Button variant="destructive" label={t('dev.vouchers.revokeYes')} onClick={() => void revoke(voucher)} isLoading={busy === voucher.id} isDisabled={busy !== null} />
                    <Button variant="secondary" label={t('dev.vouchers.revokeNo')} onClick={() => setConfirming(null)} isDisabled={busy !== null} />
                  </div>
                </div>
              ) : (
                <div>
                  <Button variant="secondary" size="sm" label={t('dev.vouchers.revoke')} onClick={() => setConfirming(voucher.id)} isDisabled={busy !== null} />
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function VoucherLimit({ voucher }: { voucher: AdminVoucher }) {
  const { t } = useLanguage();
  const client = useQueryClient();
  const [uses, setUses] = useState(String(voucher.maxRedemptions));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { setUses(String(voucher.maxRedemptions)); }, [voucher.maxRedemptions]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const value = Number(uses);
    if (!Number.isInteger(value) || value < Math.max(1, voucher.redeemedCount) || value > 10000) {
      setMessage(t('admin.vouchers.limitInvalid')); return;
    }
    setBusy(true); setMessage(null);
    try {
      await updateVoucherLimit(voucher.id, value);
      await client.invalidateQueries({ queryKey: VOUCHERS_KEY });
      setMessage(t('admin.vouchers.limitSaved'));
    } catch (error) { setMessage(friendlyError(error)); }
    finally { setBusy(false); }
  };
  return <form className="dev-voucher-limit" onSubmit={event => void save(event)}>
    <TextInput label={t('admin.vouchers.limitFor', { hint: voucher.hint })} value={uses} onChange={setUses} type="text" />
    <Button variant="secondary" label={t('admin.vouchers.saveLimit')} type="submit" isLoading={busy} isDisabled={busy || uses === String(voucher.maxRedemptions)} />
    {message && <p role="status">{message}</p>}
  </form>;
}
