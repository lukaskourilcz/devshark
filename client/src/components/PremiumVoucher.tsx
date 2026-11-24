// "Have a voucher?" on /premium (migration 045). While Stripe is switched off
// this is how Premium opens, so the page leads with it; with billing on it
// sits after the plans.
//
//   auth loading   a skeleton line, never a sign-in prompt that flashes away
//   signed out     sign in first, then come back here
//   signed in      one field and one button
//   refused        under the field: an unknown, expired, used-up or revoked
//                  code (one answer), or a voucher this account redeemed
//                  already; in a banner: too many attempts, offline, vouchers
//                  unavailable, or any other failure
//   redeemed       the end date or "no end date", and the plan refreshes in
//                  place: the page, the locks and the Profile read Premium
//                  without a reload
//
// The server decides everything; a code that cannot exist is refused here
// with the server's own answer so it costs no attempt.
//
// /premium?voucher=<code> (#239) fills the field and scrolls here; the code
// leaves the address bar at once and survives a sign-in in this tab only.
// Nothing is redeemed until the learner presses the button.
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useLanguage } from '../i18n/LanguageContext';
import { checkoutEn } from '../i18n/translations.checkoutRoute';
import type { TranslationKey } from '../i18n/translations';
import { useAuth } from '../lib/auth';
import { accountEpoch } from '../lib/accountData';
import { openSignIn } from '../lib/signInDialog';
import { entitlementKeys } from '../lib/entitlement';
import {
  forgetVoucherPrefill,
  readVoucherPrefill,
  redeemVoucher,
  rememberVoucherPrefill,
  voucherFromSearch,
  voucherLooksValid,
  voucherRefusal,
  VOUCHER_PARAM,
  VOUCHER_PATH,
  VOUCHER_SECTION_ID,
  type VoucherRefusal,
} from '../lib/voucher';

type Step =
  | { kind: 'form'; refusal?: VoucherRefusal }
  | { kind: 'done'; validUntil: string | null };

/** Refusals shown under the field, because the code itself is the problem. */
const FIELD_REFUSALS: Partial<Record<VoucherRefusal, TranslationKey>> = {
  empty: 'premium.voucher.empty',
  invalid: 'premium.voucher.invalid',
  already: 'premium.voucher.already',
};
/** Refusals shown in a banner, because trying the same code later may work. */
const BANNER_REFUSALS: Partial<Record<VoucherRefusal, TranslationKey>> = {
  'rate-limited': 'premium.voucher.rateLimited',
  offline: 'premium.voucher.offline',
  unavailable: 'premium.voucher.unavailable',
  failed: 'premium.voucher.failed',
  'signed-out': 'error.signIn',
};

/**
 * `inline` (billing on, the voucher after the plans): no card, one row, the
 * title on the left and the field and its button beside it (UX audit
 * money-09). While the voucher leads (billing off) it is the card.
 */
export default function PremiumVoucher({ billingClosed, inline = false }: { billingClosed: boolean; inline?: boolean }) {
  const { t } = useLanguage(checkoutEn);
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const headingId = useId();
  // A code from /premium?voucher=<code>, read before the first paint so the
  // field never flashes empty; kept from before a sign-in otherwise.
  const [code, setCode] = useState(() => voucherFromSearch(location.search) ?? readVoucherPrefill() ?? '');
  const [step, setStep] = useState<Step>({ kind: 'form' });
  const [busy, setBusy] = useState(false);
  // Set at the press: `busy` lands a render later, so Enter and a click
  // together sent the code twice, and the second answer ("already redeemed")
  // replaced the first one's "Premium is open".
  const redeeming = useRef(false);
  // What one account typed or opened is not the next one's: a sign-out, or a
  // different account signing in, empties the field and closes "Premium is
  // open". Signing in from signed out keeps the code (the way back from a
  // voucher link).
  const accountId = user?.id ?? null;
  const [shownFor, setShownFor] = useState(accountId);
  if (shownFor !== accountId) {
    setShownFor(accountId);
    if (shownFor !== null) {
      setCode('');
      setStep({ kind: 'form' });
    }
  }
  const input = useRef<HTMLInputElement | null>(null);
  const doneHeading = useRef<HTMLHeadingElement>(null);
  const section = useRef<HTMLElement>(null);

  // A code is not a word: no spellcheck, no autofill, capitals on a phone.
  const inputRef = useCallback((element: HTMLInputElement | null) => {
    input.current = element;
    if (!element) return;
    element.autocomplete = 'off';
    element.spellcheck = false;
    element.setAttribute('autocapitalize', 'characters');
  }, []);

  // Take the code out of the address bar and land on this section. A visitor
  // who has to sign in first keeps it for the way back.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (!params.has(VOUCHER_PARAM)) return;
    const fromLink = voucherFromSearch(location.search);
    if (fromLink) {
      setCode(fromLink);
      rememberVoucherPrefill(fromLink);
    }
    params.delete(VOUCHER_PARAM);
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '', hash: `#${VOUCHER_SECTION_ID}` }, { replace: true });
  }, [location.search, location.pathname, navigate]);

  // Once the field is on screen for a signed-in learner, the kept code has
  // done its job.
  useEffect(() => {
    if (isAuthenticated) forgetVoucherPrefill();
  }, [isAuthenticated]);

  // Arriving from the upgrade sheet (/premium#voucher), or back from sign-in:
  // bring the section into view and put the caret in the field.
  const wantsFocus = location.hash === `#${VOUCHER_SECTION_ID}`;
  useEffect(() => {
    if (!wantsFocus || authLoading) return;
    section.current?.scrollIntoView?.({ block: 'start' });
    if (isAuthenticated) input.current?.focus();
  }, [wantsFocus, authLoading, isAuthenticated]);

  useEffect(() => {
    if (step.kind === 'done') doneHeading.current?.focus();
  }, [step.kind]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (redeeming.current) return;
    if (code.trim() === '' || !voucherLooksValid(code)) {
      setStep({ kind: 'form', refusal: code.trim() === '' ? 'empty' : 'invalid' });
      input.current?.focus();
      return;
    }
    redeeming.current = true;
    setBusy(true);
    setStep({ kind: 'form' });
    const epoch = accountEpoch();
    try {
      const result = await redeemVoucher(code);
      // Signed out while the code was checked: the answer is the account
      // that left's, not news for whoever is here now.
      if (accountEpoch() !== epoch) return;
      setCode('');
      setStep({ kind: 'done', validUntil: result.validUntil });
      // The plan changed on the server: every screen that reads it (this
      // page's "Your plan", the locks, the Profile) refetches now.
      void queryClient.invalidateQueries({ queryKey: user ? entitlementKeys.user(user.id) : entitlementKeys.all });
    } catch (error) {
      if (accountEpoch() !== epoch) return;
      const refused = voucherRefusal(error);
      setStep({ kind: 'form', refusal: refused });
      // The code itself was the problem: back to the field to correct it.
      if (FIELD_REFUSALS[refused]) input.current?.focus();
    } finally {
      redeeming.current = false;
      setBusy(false);
    }
  };

  const signIn = () => openSignIn({ returnTo: VOUCHER_PATH });

  const refusal = step.kind === 'form' ? step.refusal : undefined;
  const fieldMessage = refusal && FIELD_REFUSALS[refusal] ? t(FIELD_REFUSALS[refusal]!) : null;
  const bannerMessage = refusal && BANNER_REFUSALS[refusal] ? t(BANNER_REFUSALS[refusal]!) : null;
  const longDate = (iso: string) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'long' }).format(new Date(iso));

  return (
    <section
      id={VOUCHER_SECTION_ID}
      ref={section}
      className={inline ? 'ss-premium-voucher ss-premium-voucher--inline' : 'ss-info-card ss-premium-voucher'}
      aria-labelledby={headingId}
      aria-busy={authLoading || busy || undefined}
    >
      {/* After the plans it is a section of the page and takes the page's one
          section-title size (UX audit money-08); while it leads it is a card,
          and its h2 is the card title. */}
      <h2 id={headingId} className={inline ? 'ss-section-title ss-premium-section-title' : 'ss-premium-section-title'}>{t('premium.voucher.title')}</h2>

      {step.kind === 'done' ? (
        <div className="ss-premium-voucher__done" role="status">
          <h3 ref={doneHeading} tabIndex={-1}>{t('premium.voucher.doneTitle')}</h3>
          <p className="ss-premium-voucher__end">
            {step.validUntil ? t('premium.voucher.doneUntil', { date: longDate(step.validUntil) }) : t('premium.voucher.doneNoEnd')}
          </p>
          <p>{t('billing.success.doneBody')}</p>
          <div className="ss-info-actions">
            <Button variant="primary" label={t('billing.success.openMap')} onClick={() => navigate('/learn')} />
            <Button variant="secondary" label={t('billing.success.seePlan')} onClick={() => navigate('/profile')} />
          </div>
        </div>
      ) : (
        <>
          {/* The title and the field label say what a voucher is; only a
              closed checkout needs a sentence (Premium is not on sale). */}
          {billingClosed && <p>{t('premium.voucher.leadClosed')}</p>}
          {authLoading ? (
            <span role="status" className="ss-premium-voucher__loading">
              <Skeleton width={220} height={14} radius={2} />
              <span className="ss-premium-voucher__sr">{t('premium.voucher.loading')}</span>
            </span>
          ) : !isAuthenticated ? (
            // One prompt: the button says what signing in is for (UX audit
            // money-15), with no 'Sign in first' sentence above it.
            <div className="ss-info-actions">
              <Button variant={inline ? 'secondary' : 'primary'} label={t('premium.voucher.signIn')} aria-haspopup="dialog" onClick={signIn} />
            </div>
          ) : (
            <form className="ss-premium-voucher__form" noValidate onSubmit={(event) => void submit(event)}>
              <div className="ss-premium-voucher__field">
                <TextInput
                  ref={inputRef}
                  label={t('premium.voucher.label')}
                  description={t('premium.voucher.hint')}
                  value={code}
                  onChange={(value) => {
                    setCode(value.slice(0, 64));
                    if (refusal) setStep({ kind: 'form' });
                  }}
                  status={fieldMessage ? { type: 'error', message: fieldMessage } : undefined}
                  htmlName="voucher"
                  isRequired
                />
              </div>
              {bannerMessage && <div className="ss-premium-voucher__banner"><Banner status="error" title={bannerMessage} /></div>}
              <div className="ss-info-actions">
                {/* After the plans the voucher is a secondary path, so its
                    button is secondary; while it leads it is the primary. */}
                <Button type="submit" variant={inline ? 'secondary' : 'primary'} label={t('premium.voucher.submit')} isLoading={busy} isDisabled={busy} />
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}
