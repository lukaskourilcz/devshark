// /premium (#222): what Premium costs, what it opens, and how to buy, cancel
// or withdraw.
//
//   signed out           the plan buttons keep their plan label, open sign-in
//                        and come back to that plan's checkout
//   signed in, free      the plan buttons open checkout
//   paying subscriber    "Your plan" with the plan line and Manage billing; no
//                        second checkout
//   complimentary grant  "Your plan" says so; buying stays possible
//   billing switched off one "Premium opens soon" line instead of buttons,
//                        and the page leads with "Have a voucher?"
//   settings unreachable one line that says so, with "Try again"
//
// "Have a voucher?" (PremiumVoucher.tsx, migration 045) is how Premium opens
// while Stripe is off, so it comes first then, after "Your plan" when the
// account holds Premium already. With billing on it follows the plans.
//
// The launch price (4 Oct to 2 Nov 2026, components/LaunchOffer.tsx) shows
// only while useLaunchOffer() returns it: the plan prices get the regular
// price struck through, a note says what the regular price is and from when,
// and one question explains how long it lasts. Outside the window the page is
// exactly as before.
//
// No urgency copy, no countdowns and no scarcity. The price always carries
// "VAT included", and the renewal, the waiver sentence and the refund sit next
// to the buttons, before anyone pays. The server decides every plan; this page
// only reads it.
import { useEffect, useId } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@astryxdesign/core/Button';
import { useLanguage } from '../i18n/LanguageContext';
import { checkoutEn } from '../i18n/translations.checkoutRoute';
import type { TranslationKey } from '../i18n/translations';
import { useAuth } from '../lib/auth';
import { useBilling, type BillingPlan } from '../lib/billing';
import { entitlementQuery, useEntitlement } from '../lib/entitlement';
import { readOnce, settled, useFirstData } from '../lib/routeData';
import { capture } from '../lib/analytics';
import { CURRENT_PRODUCT } from '../lib/products';
import { Page } from './PublicInfoPages';
import PlanLine from './PlanLine';
import PremiumCheckoutButton from './PremiumCheckoutButton';
import PremiumVoucher from './PremiumVoucher';
import ComparisonTable from './landing/ComparisonTable';
import { PremiumSmallPrint, premiumVars, type RenderLink } from './PremiumFacts';
import { useLaunchOffer } from '../lib/launchOffer';
import { LaunchOfferNote, OfferAmount } from './LaunchOffer';
import type { LaunchOfferDisplay } from '../../../shared/launch-offer';
import './DeepEndScreens.css';
import './PremiumPage.css';

type FaqItem = { q: TranslationKey; a: TranslationKey; link?: { to: string; label: TranslationKey } };

/** Asked first while the launch price is on. */
const OFFER_FAQ: FaqItem = { q: 'premium.page.faq.offerQ', a: 'premium.page.faq.offerA' };

const FAQ: readonly FaqItem[] = [
  { q: 'premium.page.faq.cancelQ', a: 'premium.page.faq.cancelA', link: { to: '/premium/cancel', label: 'legal.link.cancel' } },
  { q: 'premium.page.faq.progressQ', a: 'premium.page.faq.progressA' },
  { q: 'premium.page.faq.invoiceQ', a: 'premium.page.faq.invoiceA' },
  // Its own label (UX audit money-03): it opens the withdrawal, not the
  // cancellation, so it does not repeat the cancel answer's link.
  { q: 'premium.page.faq.refundQ', a: 'premium.page.faq.refundA', link: { to: '/premium/cancel?action=withdraw', label: 'premium.page.faq.refundLink' } },
  { q: 'premium.page.faq.switchQ', a: 'premium.page.faq.switchA' },
  { q: 'premium.page.faq.dataQ', a: 'premium.page.faq.dataA', link: { to: '/privacy', label: 'legal.link.privacy' } },
];

const routerLink: RenderLink = (to, label) => <Link key={to} to={to}>{label}</Link>;

function PlanCard({ plan, showAction, offer }: { plan: BillingPlan; showAction: boolean; offer: LaunchOfferDisplay | null }) {
  const { t } = useLanguage(checkoutEn);
  const id = useId();
  const vars = premiumVars();
  const annual = plan === 'annual';
  return (
    <article className="ss-info-card ss-premium-plan" aria-labelledby={id} data-plan={plan}>
      <h3 id={id}>{t(annual ? 'premium.page.annualName' : 'premium.page.monthlyName')}</h3>
      <p className="ss-premium-plan__price">
        {offer ? <OfferAmount offer={offer} plan={plan} /> : <strong>{vars.symbol}{annual ? vars.annual : vars.monthly}</strong>}{' '}
        <span>{t(annual ? 'premium.page.perYear' : 'premium.page.perMonth')}</span>
      </p>
      {/* The saving is true for the price shown above it: the launch prices
          while the offer is on, the regular ones otherwise (owner decision 11). */}
      {annual && Number(vars.saving) > 0 && (
        <p className="ss-premium-plan__saving">
          {t('premium.page.annualSaving', offer ? { saving: offer.offerAnnualSaving, currency: offer.currency } : vars)}
        </p>
      )}
      <p className="ss-premium-plan__terms">{t(annual ? 'premium.page.annualRenews' : 'premium.page.monthlyRenews')}</p>
      {showAction && (
        <div className="ss-premium-plan__action">
          <PremiumCheckoutButton plan={plan} />
        </div>
      )}
    </article>
  );
}

/** A signed-in account's plan, in the cache before the first render. It used
 * to arrive after the page and add "Your plan" above the plans, pushing
 * everything under it down. A signed-out visitor has no plan to wait for. */
function usePremiumFirstData() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  useFirstData(user ? `premium ${user.id}` : null, () => settled(user ? [readOnce(queryClient, entitlementQuery(user.id))] : []));
}

export default function PremiumPage() {
  usePremiumFirstData();
  const { t } = useLanguage(checkoutEn);
  const billing = useBilling();
  const plan = useEntitlement();
  const vars = premiumVars();
  const offer = useLaunchOffer();
  const faq = offer ? [OFFER_FAQ, ...FAQ] : FAQ;
  const ids = { plans: useId(), smallPrint: useId(), faq: useId(), current: useId() };

  useEffect(() => capture('premium_page_viewed', { product: CURRENT_PRODUCT.id }), []);

  const premium = plan.signedIn && plan.tier === 'premium' && !!plan.data;
  // A paying subscriber manages the plan they have; a second checkout would
  // charge twice, and the server refuses it anyway. A complimentary grant over
  // a live subscription counts too, as it does for PremiumCheckoutButton, or
  // each plan card would add its own Manage billing beside the plan line's.
  const paying = premium && (plan.data?.source === 'provider' || plan.data?.subscriptionLive === true);
  const closed = billing.known && !billing.enabled;
  // Offline or the API is down: the buttons cannot know what to do, so the
  // page says so rather than spinning.
  const unreachable = billing.failed;
  // Until checkout is known to be on, the voucher is the way in.
  const voucherLeads = !billing.enabled;

  return (
    <Page kicker={t('billing.kicker')} title={offer ? t('premium.page.titleOffer', offer) : t('premium.page.title', vars)} lead={t('premium.page.lead')}>
      <div className="ss-premium-page">
        {premium && (
          <section className="ss-info-card ss-premium-current" aria-labelledby={ids.current}>
            <h2 id={ids.current} className="ss-premium-section-title">{t('premium.page.yourPlan')}</h2>
            <PlanLine />
          </section>
        )}

        {voucherLeads && <PremiumVoucher billingClosed={closed} />}

        <section className="ss-premium-plans" aria-labelledby={ids.plans}>
          <h2 id={ids.plans} className="ss-section-title ss-premium-section-title">{t('premium.page.plansTitle')}</h2>
          <div className="ss-premium-plan-grid">
            <PlanCard plan="monthly" showAction={!paying && !closed && !unreachable} offer={offer} />
            <PlanCard plan="annual" showAction={!paying && !closed && !unreachable} offer={offer} />
          </div>
          {offer && <LaunchOfferNote offer={offer} />}
          {closed && <p className="ss-info-note" role="status">{t('billing.checkout.soon')}</p>}
          {unreachable && (
            <div className="ss-info-note ss-premium-unreachable" role="alert">
              <span>{t('premium.page.unreachable')}</span>
              <Button variant="secondary" size="sm" label={t('profile.plan.retry')} onClick={billing.retry} />
            </div>
          )}
          <PremiumSmallPrint t={t} link={routerLink} headingId={ids.smallPrint} />
        </section>

        {!voucherLeads && <PremiumVoucher billingClosed={false} inline />}

        {/* The table is the one statement of what Premium opens (UX audit
            money-03, shell-public-06): it has the project and FDE rows the
            'Premium includes' list had, so the list stays in the upgrade sheet
            only. Embedded, it drops its 'Plans' kicker and its VAT subtitle:
            the plan cards and 'Before you pay' say VAT where the price is. */}
        <ComparisonTable embedded showCta={false} showOfferNote={false} />

        <section className="ss-premium-faq" aria-labelledby={ids.faq}>
          <h2 id={ids.faq} className="ss-section-title ss-premium-section-title">{t('premium.page.faqTitle')}</h2>
          <div className="ss-premium-faq__list">
            {faq.map((item) => (
              <details key={item.q} className="ss-premium-faq__item">
                <summary>{t(item.q)}</summary>
                <p>{t(item.a, offer ?? undefined)}</p>
                {item.link && <p className="ss-text-links">{routerLink(item.link.to, t(item.link.label))}</p>}
              </details>
            ))}
          </div>
        </section>
      </div>
    </Page>
  );
}
