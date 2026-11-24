// The two billing pages that ship with checkout (#221):
//
//   /premium/success  where Stripe sends a buyer back. It reads the plan, and
//                     when the webhook has not arrived yet it asks the server
//                     to apply the session itself, so nobody waits on it.
//   /premium/cancel   the public cancellation and withdrawal page (§ 312k BGB,
//                     the EU withdrawal button): no sign-in, the email of the
//                     subscription, then one confirmation button. The server
//                     acts once the address is proven: at once for a signed-in
//                     owner of it, otherwise when the link it emails there is
//                     opened, which lands back here with #confirm=<token>.
//
// Neither page changes a plan by itself. The server does, from the signed
// webhook, its own lookup of the session, or a proven cancellation request.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { TextInput } from '@astryxdesign/core/TextInput';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { useLanguage } from '../i18n/LanguageContext';
import { checkoutEn } from '../i18n/translations.checkoutRoute';
import { ApiError, friendlyError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { openSignIn } from '../lib/signInDialog';
import { entitlementKeys, useEntitlement } from '../lib/entitlement';
import {
  cancelLinkToken,
  confirmCancelLink,
  isCancelReceipt,
  lookupCheckout,
  looksLikeEmail,
  requestCancellation,
  reviewCancelLink,
  useBilling,
  startCheckout,
  type CancelAction,
  type CancelLink,
  type CancelPending,
  type CancelReceipt,
} from '../lib/billing';
import { PREMIUM_PRICE, type EntitlementResponse } from '../../../shared/tiers';
import { useLaunchOffer } from '../lib/launchOffer';
import { LaunchOfferNote, OfferAmount, PremiumPriceSentence } from './LaunchOffer';
import { Page } from './PublicInfoPages';
import PremiumCheckoutButton from './PremiumCheckoutButton';
import { StatePanel } from './ui/StatePanel';
import { planText } from './PlanLine';
import './PremiumPage.css';
import './PremiumBillingPages.css';
import { CHECKOUT_APPEARANCE, loadCheckoutStripe, type CheckoutView } from '../lib/stripeCheckoutForm';
import { isOnline } from '../lib/routeRecovery';
import { accountEpoch } from '../lib/accountData';

const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]{8,240}$/;
/** How often, and how many times, the page asks again while a payment is
 * still processing. */
const RECHECK_MS = 4000;
const RECHECKS = 5;
type CheckoutRuntime = { controller: AbortController; form?: CheckoutView; timer?: number };

/** Stripe owns the iframe and card fields. The server owns the order, consent,
 * price and fulfillment; a successful browser callback never grants Premium. */
export function PremiumCheckoutPage() {
  const { t } = useLanguage(checkoutEn);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const billing = useBilling();
  const offer = useLaunchOffer();
  const { isAuthenticated, isLoading, user } = useAuth();
  const entitlement = useEntitlement();
  const plan = params.get('plan');
  const validPlan = plan === 'monthly' || plan === 'annual';
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runtime = useRef<CheckoutRuntime | null>(null);
  const card = useRef<HTMLElement>(null);
  const formHost = useRef<HTMLDivElement>(null);
  // Where focus goes once the form opens or closes: the button that opened it
  // leaves the page, and an expired form takes its fields with it. Each
  // request is a new object, applied after the render it came with, since a
  // form can open and expire before either renders.
  const [focusRequest, moveFocus] = useState<{ to: 'form' | 'consent' } | null>(null);
  useEffect(() => {
    if (!focusRequest) return;
    const target = focusRequest.to === 'form'
      ? formHost.current
      : card.current?.querySelector<HTMLElement>('input[type="checkbox"]');
    target?.focus();
  }, [focusRequest]);
  const loading = !billing.known || isLoading || (isAuthenticated && entitlement.loading);
  const paying = entitlement.data?.subscriptionLive === true || (entitlement.tier === 'premium' && entitlement.data?.source === 'provider');

  useEffect(() => {
    setConsent(false); setBusy(false); setReady(false); setError(null);
    return () => {
      runtime.current?.controller.abort();
      runtime.current?.form?.destroy();
      clearTimeout(runtime.current?.timer);
      runtime.current = null;
    };
  }, [plan, user?.id]);

  const start = async () => {
    if (!validPlan || !consent || runtime.current || !isAuthenticated || !billing.enabled || paying) return;
    if (!isOnline()) { setError(t('common.offline')); return; }
    const current: CheckoutRuntime = { controller: new AbortController() };
    runtime.current = current;
    setBusy(true); setError(null);
    current.timer = window.setTimeout(() => {
      if (runtime.current !== current) return;
      current.controller.abort(); current.form?.destroy(); runtime.current = null;
      setBusy(false); setReady(false); setError(t('premium.page.unreachable'));
    }, 45000);
    try {
      const stripe = await loadCheckoutStripe(billing.seller === 'link' ? 'embedded_page' : 'form');
      if (current.controller.signal.aborted) return;
      const session = await startCheckout(plan, current.controller.signal);
      if (current.controller.signal.aborted) return;
      if (!session.client_secret || !Number.isFinite(session.expires_at) || !['form', 'embedded_page'].includes(session.ui_mode)) throw new Error('The payment provider returned an invalid checkout.');
      let form: CheckoutView;
      if (session.ui_mode === 'embedded_page') {
        form = await stripe.createEmbeddedCheckoutPage({ fetchClientSecret: async () => session.client_secret });
        if (current.controller.signal.aborted) { form.destroy(); return; }
      } else {
        const checkout = stripe.initCheckoutFormSdk({ clientSecret: session.client_secret, appearance: CHECKOUT_APPEARANCE });
        const result = await checkout.loadActions();
        if (current.controller.signal.aborted) return;
        if (result.type !== 'success') throw new Error('The payment form could not load. Try again.');
        const checkoutForm = checkout.createForm({ layout: 'expanded' });
        form = checkoutForm;
        checkoutForm.on('confirm', async (event) => {
          if (current.controller.signal.aborted || runtime.current !== current) return;
          setBusy(true); setError(null);
          try {
            const answer = await result.actions.confirm({ formConfirmEvent: event });
            if (answer?.type === 'error') throw new Error(answer.error?.message || 'The payment could not be confirmed.');
          } catch (err) {
            if (!current.controller.signal.aborted) setError(friendlyError(err));
          } finally {
            if (!current.controller.signal.aborted) setBusy(false);
          }
        });
      }
      current.form = form;
      form.mount('#checkout-form');
      setReady(true); setBusy(false); moveFocus({ to: 'form' });
      clearTimeout(current.timer);
      current.timer = window.setTimeout(() => {
        if (runtime.current !== current) return;
        current.controller.abort(); form.destroy(); runtime.current = null;
        setReady(false); setBusy(false); setConsent(false); moveFocus({ to: 'consent' });
        setError(t('billing.success.expiredBody'));
      }, Math.max(0, session.expires_at * 1000 - Date.now()));
    } catch (err) {
      if (current.controller.signal.aborted) return;
      clearTimeout(current.timer);
      current.form?.destroy(); runtime.current = null;
      setBusy(false); setReady(false); setError(friendlyError(err));
    }
  };

  // The plan, as /premium draws it (UX audit money-04): the name, the price in
  // ink at the plan cards' size, and one renewal line. Shown signed out too,
  // so the lead's 'Review your plan' always has a plan to review.
  const summary = validPlan && (
    <div className="ss-premium-plan ss-checkout-plan">
      <h2>{t(plan === 'annual' ? 'premium.page.annualName' : 'premium.page.monthlyName')}</h2>
      <p className="ss-premium-plan__price">
        {offer ? <OfferAmount offer={offer} plan={plan} /> : <strong>{PREMIUM_PRICE.symbol}{PREMIUM_PRICE[plan]}</strong>}{' '}
        <span>{t(plan === 'annual' ? 'premium.page.perYear' : 'premium.page.perMonth')}</span>
      </p>
      {offer && <LaunchOfferNote offer={offer} compact />}
      <p className="ss-premium-plan__terms">{t(plan === 'annual' ? 'premium.page.annualRenews' : 'premium.page.monthlyRenews')}</p>
    </div>
  );
  const canContinue = !billing.failed && !loading && validPlan && billing.enabled && isAuthenticated && !paying && !ready;

  // The 'devShark Premium' kicker names every purchase step (money-08).
  return <Page kicker={t('billing.kicker')} title={t('billing.checkout.title')} lead={t('billing.checkout.lead')}>
    <section className="ss-info-card ss-billing-card ss-checkout-card" ref={card}>
      {billing.failed ? <><Banner status="error" title={t('premium.page.unreachable')} /><Button className="ss-action" label={t('profile.plan.retry')} onClick={billing.retry} /></>
        : loading ? <p role="status">{t('billing.checkout.loading')}</p> : !validPlan ? <Banner status="error" title={t('billing.checkout.choosePlan')} />
        : !billing.enabled ? <p>{t('billing.checkout.soon')}</p>
          : !isAuthenticated ? <>
              {summary}
              {/* The inline signed-out state (money-05), under the plan. */}
              <StatePanel inline body={t('billing.checkout.signedOut')} signIn={{ label: t('billing.checkout.signIn'), returnTo: `/premium/checkout?plan=${plan}` }} />
            </>
            : paying ? <PremiumCheckoutButton plan={plan} /> : <>
              {summary}
              <p className="ss-text-links"><Link to="/terms">{t('legal.link.terms')}</Link><Link to="/privacy">{t('legal.link.privacy')}</Link></p>
              {/* The only box on the step, and Continue stays disabled until it
                  is ticked, so it carries no 'Required' marker (money-04). */}
              <CheckboxInput value={consent} onChange={setConsent} label={t('billing.checkout.consent')} isDisabled={busy || ready} />
              {busy && <p aria-hidden="true">{t(ready ? 'billing.success.checkingStatus' : 'billing.checkout.loading')}</p>}
              {/* A live region mounted with its words is not announced, so this
                  one stays on the page and only its text changes. */}
              <p className="ss-sr-only" role="status">{busy ? t(ready ? 'billing.success.checkingStatus' : 'billing.checkout.loading') : ''}</p>
            </>}
      {error && <p role="alert">{error}</p>}
      <div id="checkout-form" className="ss-checkout-form" data-ready={ready} ref={formHost} tabIndex={-1} />
      {/* One footer row (money-04): Back to plans as a ghost on the left, the
          step's one primary on the right; below 600px the primary stacks
          full width above it. */}
      <div className="ss-checkout-actions">
        <Button variant="ghost" className="ss-action" label={t('billing.checkout.back')} onClick={() => navigate('/premium')} />
        {canContinue && <Button variant="primary" className="ss-action" label={t('billing.checkout.openForm')} onClick={() => void start()} isDisabled={!consent || busy} isLoading={busy} />}
      </div>
    </section>
  </Page>;
}

type SuccessState =
  | { kind: 'checking' }
  | { kind: 'done'; plan: EntitlementResponse }
  | { kind: 'pending' }
  | { kind: 'expired' }
  | { kind: 'missing' }
  | { kind: 'error'; message: string };

export function PremiumSuccessPage() {
  const { t } = useLanguage(checkoutEn);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const sessionId = params.get('session_id') ?? '';
  const validSession = SESSION_ID.test(sessionId);
  const { isAuthenticated, isLoading: authLoading, user } = useAuth();
  const plan = useEntitlement();
  const queryClient = useQueryClient();
  const [state, setState] = useState<SuccessState>({ kind: 'checking' });
  // An expired checkout offers both plans again, at the launch price while it is on.
  const offer = useLaunchOffer();
  const rechecks = useRef(0);
  const started = useRef(false);
  const userId = user?.id ?? null;
  // The lookup on its way, so a newer one, another account or leaving the
  // page drops its answer.
  const lookup = useRef<AbortController | null>(null);

  const check = useCallback(async () => {
    lookup.current?.abort();
    const controller = new AbortController();
    lookup.current = controller;
    const epoch = accountEpoch();
    const stale = () => controller.signal.aborted || accountEpoch() !== epoch;
    setState({ kind: 'checking' });
    try {
      const result = await lookupCheckout(sessionId, controller.signal);
      if (stale()) return;
      // Only a completed checkout is a purchase. A voucher or complimentary
      // grant already reads Premium while this payment is still processing.
      if (result.status === 'complete' && result.entitlement.tier === 'premium') {
        if (userId) queryClient.setQueryData(entitlementKeys.user(userId), result.entitlement);
        void queryClient.invalidateQueries({ queryKey: entitlementKeys.all });
        setState({ kind: 'done', plan: result.entitlement });
        return;
      }
      setState(result.status === 'expired' ? { kind: 'expired' } : { kind: 'pending' });
    } catch (error) {
      if (stale()) return;
      if (error instanceof ApiError && error.status === 404) setState({ kind: 'missing' });
      else setState({ kind: 'error', message: friendlyError(error) });
    } finally {
      if (lookup.current === controller) lookup.current = null;
    }
  }, [sessionId, queryClient, userId]);

  // Another account (or none) starts over: what this page learnt belongs to
  // the account that asked. Leaving drops the answer still on its way.
  useEffect(() => {
    started.current = false;
    rechecks.current = 0;
    setState((current) => (current.kind === 'checking' ? current : { kind: 'checking' }));
    return () => {
      lookup.current?.abort();
      lookup.current = null;
    };
  }, [userId]);

  // Once the account and its plan are known: a subscription that is already
  // live (the webhook came first) needs no lookup; otherwise ask the server.
  // Premium from a voucher or a complimentary grant says nothing about this
  // checkout, so it is asked about like a free plan.
  useEffect(() => {
    if (started.current || !validSession || authLoading || !isAuthenticated || plan.loading) return;
    started.current = true;
    const subscribed = plan.data?.subscriptionLive === true || plan.data?.source === 'provider';
    if (plan.tier === 'premium' && plan.data && subscribed) setState({ kind: 'done', plan: plan.data });
    else void check();
  }, [validSession, authLoading, isAuthenticated, plan.loading, plan.tier, plan.data, check]);

  // A payment still processing is asked about again a few times.
  useEffect(() => {
    if (state.kind !== 'pending' || rechecks.current >= RECHECKS) return;
    const timer = window.setTimeout(() => {
      rechecks.current += 1;
      void check();
    }, RECHECK_MS);
    return () => window.clearTimeout(timer);
  }, [state, check]);

  const view: SuccessState | { kind: 'signin' } =
    !validSession ? { kind: 'missing' } : !authLoading && !isAuthenticated ? { kind: 'signin' } : state;

  const copy = {
    checking: { title: t('billing.success.checkingTitle'), lead: t('billing.success.checkingBody') },
    done: { title: t('billing.success.doneTitle'), lead: t('billing.success.doneBody') },
    pending: { title: t('billing.success.pendingTitle'), lead: t('billing.success.pendingBody') },
    expired: { title: t('billing.success.expiredTitle'), lead: t('billing.success.expiredBody') },
    missing: { title: t('billing.success.missingTitle'), lead: t('billing.success.missingBody') },
    error: { title: t('billing.success.errorTitle'), lead: t('billing.success.errorBody') },
    signin: { title: t('billing.success.signInTitle'), lead: t('billing.success.signInBody') },
  }[view.kind];

  return (
    <Page kicker={t('billing.kicker')} title={copy.title} lead={copy.lead}>
      <section className="ss-info-card ss-billing-card" aria-labelledby="billing-status-label">
        <h2 id="billing-status-label" className="ss-billing-card__label">{t('billing.success.statusLabel')}</h2>
        <div role="status" aria-live="polite" className="ss-billing-status">
          {view.kind === 'checking' && (
            <>
              <Skeleton width={220} height={14} radius={2} />
              <span>{t('billing.success.checkingStatus')}</span>
            </>
          )}
          {view.kind === 'done' && <strong>{t('billing.success.doneStatus', { plan: planText(view.plan, t) })}</strong>}
          {view.kind === 'pending' && (
            // After the last automatic check nothing checks again until the
            // button is pressed, so the line stops promising that it will.
            <span>{t(rechecks.current >= RECHECKS ? 'billing.success.pendingStopped' : 'billing.success.pendingStatus')}</span>
          )}
          {view.kind === 'expired' && (
            <span>{t('billing.success.expiredStatus')} <PremiumPriceSentence offer={offer} /></span>
          )}
          {view.kind === 'missing' && <span>{t('billing.success.missingStatus')}</span>}
          {view.kind === 'signin' && <span>{t('billing.success.signInStatus')}</span>}
        </div>
        {view.kind === 'expired' && offer && <LaunchOfferNote offer={offer} compact />}
        {view.kind === 'error' && <Banner status="error" title={view.message} />}
        <div className="ss-info-actions">
          {view.kind === 'done' && (
            <>
              <Button variant="primary" label={t('billing.success.openMap')} onClick={() => navigate('/learn')} />
              <Button variant="secondary" label={t('billing.success.seePlan')} onClick={() => navigate('/profile')} />
            </>
          )}
          {(view.kind === 'pending' || view.kind === 'error') && (
            <>
              <Button variant="primary" label={t('billing.success.checkAgain')} onClick={() => { rechecks.current = 0; void check(); }} />
              <Button variant="secondary" label={t('billing.success.goProfile')} onClick={() => navigate('/profile')} />
            </>
          )}
          {view.kind === 'expired' && (
            <>
              <PremiumCheckoutButton plan="monthly" />
              <PremiumCheckoutButton plan="annual" />
            </>
          )}
          {view.kind === 'missing' && <Button variant="primary" label={t('billing.success.goProfile')} onClick={() => navigate('/profile')} />}
          {view.kind === 'signin' && (
            <Button
              variant="primary"
              label={t('auth.logIn')}
              aria-haspopup="dialog"
              // Come back to this checkout after signing in.
              onClick={() => openSignIn({ returnTo: `/premium/success?session_id=${encodeURIComponent(sessionId)}` })}
            />
          )}
        </div>
      </section>
    </Page>
  );
}

/* ── /premium/cancel ─────────────────────────────────────────────────────── */

type CancelStep =
  | { kind: 'form' }
  | { kind: 'confirm' }
  | { kind: 'sent'; answer: Extract<CancelPending, { confirmBy: 'email' }> }
  | { kind: 'signin' }
  | { kind: 'link-loading' }
  | { kind: 'link'; link: CancelLink }
  | { kind: 'link-expired' }
  | { kind: 'link-error'; message: string }
  | { kind: 'done'; receipt: CancelReceipt };

export function PremiumCancelPage() {
  const { t } = useLanguage(checkoutEn);
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  // Until the settings arrive the form stays usable and the server decides;
  // it is closed only when the server says billing is not set up.
  const billing = useBilling();
  const unavailable = billing.known && !billing.cancellable;
  const [action, setAction] = useState<CancelAction>(params.get('action') === 'withdraw' ? 'withdraw' : 'cancel');
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One request at a time: a second press can land before `busy` disables the
  // button, and a second confirmation would act or email twice.
  const sending = useRef(false);
  const send = async (request: () => Promise<void>) => {
    if (sending.current) return;
    sending.current = true;
    setError(null);
    setBusy(true);
    try {
      await request();
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  // The emailed link lands here with #confirm=<token>. It is read once.
  const [token] = useState(() => cancelLinkToken(location.hash));
  const [step, setStep] = useState<CancelStep>(token ? { kind: 'link-loading' } : { kind: 'form' });
  const stepRef = useRef<HTMLElement>(null);
  const firstStep = useRef(true);

  // Each step replaces the last, so move focus to its heading. Back on the
  // form, focus goes to the email field, not to the top of the document. The
  // page's first view keeps the focus the router gave it.
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      if (step.kind === 'form') return;
    }
    const target = step.kind === 'form'
      ? stepRef.current?.querySelector<HTMLElement>('input[type="email"]')
      : stepRef.current?.querySelector<HTMLElement>('h2');
    target?.focus();
  }, [step.kind]);

  // Take the token out of the address bar at once, so it stays out of the
  // history, a screenshot and every analytics event, then ask what it is for.
  // Try again asks once more with the token held here: a reload would find
  // the address without it.
  const [reviews, setReviews] = useState(0);
  useEffect(() => {
    if (!token) return;
    navigate({ pathname: location.pathname, search: location.search }, { replace: true });
    let live = true;
    reviewCancelLink(token)
      .then((link) => {
        if (!live) return;
        setAction(link.action);
        setEmail(link.email);
        setStep({ kind: 'link', link });
      })
      .catch((err) => {
        if (!live) return;
        setStep(err instanceof ApiError && (err.status === 410 || err.status === 400)
          ? { kind: 'link-expired' }
          : { kind: 'link-error', message: friendlyError(err) });
      });
    return () => { live = false; };
    // Once per token and Try again: the navigation above changes the
    // location, not the token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, reviews]);

  const withdraw = action === 'withdraw';
  const owner = isAuthenticated && typeof user?.email === 'string' && user.email.toLowerCase() === email.trim().toLowerCase();

  const submitForm = async () => {
    if (sending.current) return;
    setError(null);
    if (!looksLikeEmail(email)) {
      setEmailError(t('error.badEmail'));
      return;
    }
    setEmailError(null);
    await send(async () => {
      try {
        await requestCancellation(email.trim(), action, 'request');
        setStep({ kind: 'confirm' });
      } catch (err) {
        if (err instanceof ApiError && err.code === 'bad_email') setEmailError(t('error.badEmail'));
        else setError(friendlyError(err));
      }
    });
  };

  const confirm = () => send(async () => {
    try {
      const answer = await requestCancellation(email.trim(), action, 'confirm');
      if (isCancelReceipt(answer)) setStep({ kind: 'done', receipt: answer });
      else if (answer.confirmBy === 'email') setStep({ kind: 'sent', answer });
      else setStep({ kind: 'signin' });
    } catch (err) {
      setError(friendlyError(err));
    }
  });

  const confirmLink = async () => {
    if (!token) return;
    await send(async () => {
      try {
        setStep({ kind: 'done', receipt: await confirmCancelLink(token) });
      } catch (err) {
        if (err instanceof ApiError && err.status === 410) setStep({ kind: 'link-expired' });
        else setError(friendlyError(err));
      }
    });
  };

  const startAgain = () => { setError(null); setStep({ kind: 'form' }); };
  const dateTime = (iso: string) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(iso));
  const date = (iso: string) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'long' }).format(new Date(iso));
  const effect = withdraw
    ? t('billing.cancel.confirmWithdrawBody', { email: email.trim() })
    : t('billing.cancel.confirmBody', { email: email.trim() });

  return (
    <Page kicker={t('billing.kicker')} title={t('billing.cancel.title')} lead={t('billing.cancel.lead')}>
      <section className="ss-info-card ss-billing-card" ref={stepRef}>
        {unavailable && <p className="ss-info-note">{t('billing.cancel.unavailable')}</p>}

        {step.kind === 'form' && (
          <form
            className="ss-billing-form"
            noValidate
            onSubmit={(event) => { event.preventDefault(); void submitForm(); }}
          >
            <RadioList
              label={t('billing.cancel.choiceLabel')}
              value={action}
              onChange={(value) => setAction(value === 'withdraw' ? 'withdraw' : 'cancel')}
            >
              <RadioListItem value="cancel" label={t('billing.cancel.optionCancel')} description={t('billing.cancel.optionCancelBody')} />
              <RadioListItem value="withdraw" label={t('billing.cancel.optionWithdraw')} description={t('billing.cancel.optionWithdrawBody')} />
            </RadioList>
            <TextInput
              type="email"
              htmlName="email"
              label={t('billing.cancel.emailLabel')}
              description={t('billing.cancel.emailHint')}
              value={email}
              onChange={(value) => { setEmail(value.slice(0, 254)); if (emailError) setEmailError(null); }}
              status={emailError ? { type: 'error', message: emailError } : undefined}
              isRequired
              isDisabled={unavailable}
            />
            {error && <Banner status="error" title={error} />}
            <div className="ss-info-actions">
              <Button type="submit" variant="primary" label={t('billing.cancel.continue')} isLoading={busy} isDisabled={busy || unavailable} />
            </div>
          </form>
        )}

        {step.kind === 'confirm' && (
          <div className="ss-billing-confirm">
            <h2 tabIndex={-1}>{withdraw ? t('billing.cancel.confirmWithdrawTitle') : t('billing.cancel.confirmTitle')}</h2>
            <p>{effect}</p>
            <p className="ss-info-note">
              {owner
                ? t('billing.cancel.confirmOwner')
                : billing.known && !billing.cancelByEmail
                  ? t('billing.cancel.confirmSignIn')
                  : t('billing.cancel.confirmByEmail', { email: email.trim() })}
            </p>
            {error && <Banner status="error" title={error} />}
            <div className="ss-info-actions">
              <Button
                variant="destructive"
                label={withdraw ? t('billing.cancel.confirmWithdraw') : t('billing.cancel.confirmCancel')}
                onClick={() => void confirm()}
                isLoading={busy}
                isDisabled={busy}
              />
              <Button variant="secondary" label={t('billing.cancel.back')} onClick={startAgain} isDisabled={busy} />
            </div>
          </div>
        )}

        {step.kind === 'sent' && (
          <div className="ss-billing-confirm">
            <h2 tabIndex={-1}>{t('billing.cancel.sentTitle')}</h2>
            <p role="status">{t('billing.cancel.sentBody', { email: step.answer.email, minutes: step.answer.expiresInMinutes })}</p>
            <p>{t('billing.cancel.receivedAt', { date: dateTime(step.answer.receivedAt), email: step.answer.email })}</p>
            <p className="ss-info-note">{t('billing.cancel.sentNote')}</p>
            <p className="ss-info-note">{t('billing.cancel.keep')}</p>
            <div className="ss-info-actions">
              <Button variant="secondary" label={t('billing.cancel.back')} onClick={startAgain} />
            </div>
          </div>
        )}

        {step.kind === 'signin' && (
          <div className="ss-billing-confirm">
            <h2 tabIndex={-1}>{t('billing.cancel.signInTitle')}</h2>
            <p>{t('billing.cancel.signInBody', { email: email.trim() })}</p>
            {error && <Banner status="error" title={error} />}
            <div className="ss-info-actions">
              <Button
                variant="primary"
                label={t('auth.logIn')}
                aria-haspopup="dialog"
                onClick={() => {
                  setError(null);
                  openSignIn({ returnTo: `/premium/cancel?action=${action}`, email: email.trim() });
                }}
              />
              <Button variant="secondary" label={t('billing.cancel.back')} onClick={startAgain} />
            </div>
          </div>
        )}

        {step.kind === 'link-loading' && (
          <div className="ss-billing-confirm">
            <h2 tabIndex={-1}>{t('billing.cancel.linkLoading')}</h2>
            <Skeleton width={220} height={14} radius={2} />
          </div>
        )}

        {step.kind === 'link' && (
          <div className="ss-billing-confirm">
            <h2 tabIndex={-1}>{withdraw ? t('billing.cancel.confirmWithdrawTitle') : t('billing.cancel.confirmTitle')}</h2>
            <p>{t('billing.cancel.linkRequested', { date: dateTime(step.link.requestedAt), email: step.link.email })}</p>
            <p>{effect}</p>
            {error && <Banner status="error" title={error} />}
            <div className="ss-info-actions">
              <Button
                variant="destructive"
                label={withdraw ? t('billing.cancel.confirmWithdraw') : t('billing.cancel.confirmCancel')}
                onClick={() => void confirmLink()}
                isLoading={busy}
                isDisabled={busy}
              />
              <Button variant="secondary" label={t('billing.cancel.keepSubscription')} onClick={() => navigate('/')} isDisabled={busy} />
            </div>
          </div>
        )}

        {step.kind === 'link-expired' && (
          <div className="ss-billing-confirm">
            <h2 tabIndex={-1}>{t('billing.cancel.linkExpiredTitle')}</h2>
            <p>{t('billing.cancel.linkExpiredBody')}</p>
            <div className="ss-info-actions">
              <Button variant="primary" label={t('billing.cancel.startAgain')} onClick={startAgain} />
            </div>
          </div>
        )}

        {step.kind === 'link-error' && (
          <div className="ss-billing-confirm">
            <h2 tabIndex={-1}>{t('billing.cancel.linkErrorTitle')}</h2>
            <Banner status="error" title={step.message} />
            <div className="ss-info-actions">
              <Button variant="primary" label={t('billing.cancel.tryAgain')} onClick={() => { setStep({ kind: 'link-loading' }); setReviews((count) => count + 1); }} />
              <Button variant="secondary" label={t('billing.cancel.startAgain')} onClick={startAgain} />
            </div>
          </div>
        )}

        {step.kind === 'done' && (
          <div className="ss-billing-confirm">
            <h2 tabIndex={-1}>{withdraw ? t('billing.cancel.doneWithdrawTitle') : t('billing.cancel.doneTitle')}</h2>
            <p>{t('billing.cancel.receivedAt', { date: dateTime(step.receipt.receivedAt), email: step.receipt.email })}</p>
            <CancelOutcome receipt={step.receipt} date={date} />
            <p className="ss-info-note">{t('billing.cancel.keep')}</p>
            <div className="ss-info-actions">
              <Button variant="secondary" label={t('billing.cancel.home')} onClick={() => navigate('/')} />
            </div>
          </div>
        )}
      </section>
    </Page>
  );
}

/** What changed, once the address was proven. */
function CancelOutcome({ receipt, date }: { receipt: CancelReceipt; date: (iso: string) => string }) {
  const { t } = useLanguage(checkoutEn);
  if (receipt.details.length === 0) return <p>{t('billing.cancel.doneNone')}</p>;
  // Two subscriptions that end the same way read as one line.
  const lines = [...new Set(receipt.details.map((detail) => (detail.withdrawn
    ? t(detail.refunded ? 'billing.cancel.doneWithdrawn' : 'billing.cancel.doneWithdrawnUnpaid')
    : detail.endsAt
      ? t('billing.cancel.doneEndsAt', { date: date(detail.endsAt) })
      : t('billing.cancel.doneGeneric'))))];
  return (
    <>
      {lines.length === 1
        ? <p>{lines[0]}</p>
        : <ul className="ss-billing-outcomes">{lines.map((line) => <li key={line}>{line}</li>)}</ul>}
      {receipt.emailed && <p>{t('billing.cancel.doneEmailed')}</p>}
    </>
  );
}
