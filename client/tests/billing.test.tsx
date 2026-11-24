import { trackAnnouncement } from './announcement';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { delay, http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { isStripeHostedUrl, looksLikeEmail } from '../src/lib/billing';
import { PremiumCancelPage, PremiumCheckoutPage, PremiumSuccessPage } from '../src/components/PremiumBillingPages';
import PlanLine from '../src/components/PlanLine';
import BrandFooter from '../src/components/BrandFooter';
import PremiumCheckoutButton from '../src/components/PremiumCheckoutButton';
import { server } from './mocks/server';

const auth = vi.hoisted(() => ({
  value: { user: null as { id: string } | null, isAuthenticated: false, isLoading: false, signInWithGoogle: async () => undefined },
}));
vi.mock('../src/lib/auth', () => ({ useAuth: () => auth.value }));
// Signing in opens the sign-in dialog (Google, or an email and password).
const openSignIn = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/signInDialog', async (importOriginal) => ({ ...(await importOriginal<object>()), openSignIn }));
const signIn = () => { auth.value = { ...auth.value, user: { id: 'user-1' }, isAuthenticated: true }; };
afterEach(() => { auth.value = { ...auth.value, user: null, isAuthenticated: false }; openSignIn.mockClear(); delete window.Stripe; vi.unstubAllEnvs(); });

const FREE = { tier: 'free', source: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, inGrace: false, validUntil: null };
const PREMIUM = { ...FREE, tier: 'premium', source: 'provider', currentPeriodEnd: '2026-11-12T10:00:00.000Z' };
const SESSION = 'cs_test_a1ContractSession0001';

/** /api/settings with the billing switches, and the plan. */
function serve({ plan = FREE, billing = { enabled: true, cancellable: true, seller: 'link' } }: { plan?: unknown; billing?: unknown } = {}) {
  server.use(
    http.get('*/api/settings', () => HttpResponse.json({ billing })),
    http.get('*/api/user/*', ({ request }) => new URL(request.url).searchParams.get('op') === 'entitlement' || request.url.includes('/entitlement')
      ? HttpResponse.json(plan as never)
      : undefined),
  );
}

/** Shows the router's current hash, so a test can see the link's token leave it. */
function HashProbe() {
  return <><output data-testid="hash">{useLocation().hash}</output><output data-testid="location">{useLocation().pathname + useLocation().search}</output></>;
}

function renderAt(path: string, node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <LanguageProvider>{node}<HashProbe /></LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('the browser only ever leaves for Stripe', () => {
  it('accepts Stripe-hosted https addresses and nothing else', () => {
    expect(isStripeHostedUrl('https://checkout.stripe.com/c/pay/cs_test_1')).toBe(true);
    expect(isStripeHostedUrl('https://billing.stripe.com/p/session/test')).toBe(true);
    expect(isStripeHostedUrl('http://checkout.stripe.com/c/pay/x')).toBe(false);
    expect(isStripeHostedUrl('https://checkout.stripe.com.evil.example/c')).toBe(false);
    expect(isStripeHostedUrl('javascript:alert(1)')).toBe(false);
    expect(looksLikeEmail(' learner@example.com ')).toBe(true);
    expect(looksLikeEmail('learner@')).toBe(false);
  });
});

describe('the embedded checkout', () => {
  let mockStripeClient: ReturnType<NonNullable<Window['Stripe']>>;
  const secret = `${SESSION}_secret_not_logged`;
  function stripeUi(uiMode: 'embedded_page' | 'form' = 'embedded_page', expiresAt = Math.floor(Date.now() / 1000) + 3600) {
    vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', 'pk_test_client_contract');
    const mount = vi.fn(); const destroy = vi.fn(); const confirm = vi.fn().mockResolvedValue({ type: 'success' });
    const on = vi.fn(); const form = { mount, destroy, on };
    const createEmbeddedCheckoutPage = vi.fn(async (_options: { fetchClientSecret: () => Promise<string> }) => form);
    const initCheckoutFormSdk = vi.fn().mockReturnValue({ createForm: vi.fn().mockReturnValue(form), loadActions: vi.fn().mockResolvedValue({ type: 'success', actions: { confirm } }) });
    mockStripeClient = { createEmbeddedCheckoutPage, initCheckoutFormSdk };
    window.Stripe = vi.fn(() => mockStripeClient);
    const append = document.head.append.bind(document.head);
    vi.spyOn(document.head, 'append').mockImplementation((...nodes) => {
      append(...nodes);
      for (const node of nodes) if (node instanceof HTMLScriptElement && node.src.startsWith('https://js.stripe.com/')) {
        queueMicrotask(() => node.dispatchEvent(new Event('load')));
      }
    });
    const create = vi.fn();
    server.use(http.post('*/api/user/billing-checkout', async ({ request }) => {
      create(await request.json());
      return HttpResponse.json({ client_secret: secret, session_id: SESSION, expires_at: expiresAt, ui_mode: uiMode });
    }));
    return { mount, destroy, confirm, on, createEmbeddedCheckoutPage, initCheckoutFormSdk, create };
  }
  async function acceptAndOpen() {
    const checkbox = await screen.findByRole('checkbox');
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: 'Continue to secure payment' }));
  }

  it('requires consent and mounts Managed Payments inside Stripe without leaking the client secret', async () => {
    signIn(); serve(); const ui = stripeUi();
    const view = renderAt('/premium/checkout?plan=annual', <PremiumCheckoutPage />);
    const checkbox = await screen.findByRole('checkbox');
    expect(checkbox).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Continue to secure payment' })).toBeDisabled();
    expect(ui.create).not.toHaveBeenCalled();
    await acceptAndOpen();
    await waitFor(() => expect(ui.mount).toHaveBeenCalledWith('#checkout-form'));
    expect(ui.create).toHaveBeenCalledExactlyOnceWith({ plan: 'annual', consent: true });
    expect(ui.createEmbeddedCheckoutPage).toHaveBeenCalledOnce();
    expect(await ui.createEmbeddedCheckoutPage.mock.calls[0][0].fetchClientSecret()).toBe(secret);
    expect(document.querySelector('script[src="https://js.stripe.com/endive/stripe.js"]')).not.toBeNull();
    expect(ui.initCheckoutFormSdk).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain(secret);
    expect(screen.getByTestId('location')).not.toHaveTextContent(secret);
    expect(checkbox).toBeDisabled();
    // The button that opened the form left the page: focus waits on the form.
    expect(document.getElementById('checkout-form')).toHaveFocus();
    view.unmount(); expect(ui.destroy).toHaveBeenCalledOnce();
  });

  // UX audit shell-public-13 and -02: every billing step names itself the same way,
  // so the h1 stands at one height from checkout to success and cancel.
  it('carries the billing kicker like its sibling pages, and draws its own action as a page action', async () => {
    signIn(); serve(); stripeUi();
    renderAt('/premium/checkout?plan=annual', <PremiumCheckoutPage />);
    await screen.findByRole('checkbox');
    const kicker = document.querySelector('.ss-info-page__kicker');
    expect(kicker).toHaveTextContent('devShark Premium');
    expect(kicker).not.toHaveAttribute('aria-hidden');
    // The step's action is a page action in the card's footer row.
    const open = screen.getByRole('button', { name: 'Continue to secure payment' });
    expect(open).toHaveClass('astryx-button', 'ss-action');
    expect(open.parentElement).toHaveClass('ss-checkout-actions');
  });

  // UX audit money-04: the last step before paying has one primary, the plan
  // drawn as /premium draws it, and no 'Required' marker on its one box.
  it('shows the plan as /premium does, with Continue as the one primary beside a ghost Back', async () => {
    signIn(); serve(); stripeUi();
    renderAt('/premium/checkout?plan=monthly', <PremiumCheckoutPage />);
    const checkbox = await screen.findByRole('checkbox');
    const plan = document.querySelector<HTMLElement>('.ss-checkout-card .ss-premium-plan')!;
    expect(within(plan).getByRole('heading', { level: 2, name: 'Monthly' })).toBeInTheDocument();
    expect(plan.querySelector('.ss-premium-plan__price strong')).toHaveTextContent('€4.99');
    expect(within(plan).getByText('a month')).toBeInTheDocument();
    expect(within(plan).getByText('before VAT. Renews every month until you cancel.')).toHaveClass('ss-premium-plan__terms');
    expect(checkbox).not.toBeRequired();
    expect(screen.queryByText('Required')).toBeNull();
    const row = document.querySelector<HTMLElement>('.ss-checkout-actions')!;
    const [back, open] = within(row).getAllByRole('button');
    expect(back).toHaveAccessibleName('Back to plans');
    expect(open).toHaveAccessibleName('Continue to secure payment');
    // Astryx names the variant in a class of its own.
    expect(open).toHaveClass('primary');
    expect(back).toHaveClass('ghost');
    expect(document.querySelectorAll('.ss-checkout-card .astryx-button.primary')).toHaveLength(1);
  });

  it('wires the form preview confirmation and shows a failed confirmation without granting a plan', async () => {
    signIn(); serve({ billing: { enabled: true, cancellable: true, seller: 'trader' } }); const ui = stripeUi('form');
    renderAt('/premium/checkout?plan=monthly', <PremiumCheckoutPage />);
    await acceptAndOpen();
    await waitFor(() => expect(ui.on).toHaveBeenCalled());
    const event = { type: 'confirm' };
    ui.confirm.mockResolvedValue({ type: 'error', error: { message: 'Card declined' } });
    await act(async () => { await ui.on.mock.calls[0][1](event); });
    expect(ui.confirm).toHaveBeenCalledExactlyOnceWith({ formConfirmEvent: event });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Everything is open now.')).not.toBeInTheDocument();
  });

  it('announces loading and checking in a status line that is on the page before it speaks', async () => {
    signIn(); serve({ billing: { enabled: true, cancellable: true, seller: 'trader' } }); const ui = stripeUi('form');
    renderAt('/premium/checkout?plan=monthly', <PremiumCheckoutPage />);
    await screen.findByRole('checkbox');
    // Mounted empty: a region inserted with its words is not read out.
    const statusLine = () => document.querySelector<HTMLElement>('.ss-checkout-card p[role="status"]');
    const status = statusLine()!;
    expect(status).not.toBeNull();
    expect(status).toHaveTextContent('');
    await acceptAndOpen();
    expect(status).toHaveTextContent('Opening secure payment');
    await waitFor(() => expect(ui.on).toHaveBeenCalled());
    await waitFor(() => expect(status).toHaveTextContent(''));
    let settle!: (value: { type: string }) => void;
    ui.confirm.mockReturnValue(new Promise((done) => { settle = done; }));
    act(() => { void ui.on.mock.calls[0][1]({ type: 'confirm' }); });
    expect(statusLine()).toBe(status);
    expect(status).toHaveTextContent('Checking with Stripe');
    await act(async () => { settle({ type: 'success' }); });
    expect(status).toHaveTextContent('');
  });

  it('handles expiry with a new consent step and destroys the expired form', async () => {
    signIn(); serve(); const ui = stripeUi('embedded_page', Math.floor(Date.now() / 1000) - 1);
    renderAt('/premium/checkout?plan=monthly', <PremiumCheckoutPage />);
    await acceptAndOpen();
    expect(await screen.findByRole('alert')).toHaveTextContent('The checkout closed before payment');
    expect(ui.destroy).toHaveBeenCalledOnce();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Continue to secure payment' })).toBeDisabled();
    // The form and its fields are gone: focus goes back to the consent.
    await waitFor(() => expect(screen.getByRole('checkbox')).toHaveFocus());
  });

  it('shows the server refusal and lets the learner retry', async () => {
    signIn(); serve(); stripeUi();
    server.use(http.post('*/api/user/billing-checkout', () => HttpResponse.json({ error: { code: 'already_premium', message: 'active' } }, { status: 409 })));
    renderAt('/premium/checkout?plan=monthly', <PremiumCheckoutPage />);
    await acceptAndOpen();
    expect(await screen.findByRole('alert')).toHaveTextContent('You already have a Premium subscription');
    expect(screen.getByRole('button', { name: 'Continue to secure payment' })).toBeEnabled();
  });

  it('asks a signed-out learner to sign in before creating an order', async () => {
    serve(); const ui = stripeUi();
    renderAt('/premium/checkout?plan=monthly', <PremiumCheckoutPage />);
    // The plan is there to review signed out too, with the money screens'
    // one signed-out block under it (money-04, money-05).
    expect(await screen.findByRole('heading', { level: 2, name: 'Monthly' })).toBeInTheDocument();
    expect(screen.getByText('You pay on the account you sign in with, and you come back to this plan.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
    const signInButton = screen.getByRole('button', { name: 'Sign in to continue' });
    expect(signInButton).toHaveAttribute('aria-haspopup', 'dialog');
    fireEvent.click(signInButton);
    expect(openSignIn).toHaveBeenCalledWith({ returnTo: '/premium/checkout?plan=monthly' });
    expect(ui.create).not.toHaveBeenCalled(); expect(ui.createEmbeddedCheckoutPage).not.toHaveBeenCalled();
  });
});

describe('/premium/success', () => {
  it('asks the server to apply the session when the plan is still free', async () => {
    signIn();
    serve();
    let looked = 0;
    server.use(http.get('*/api/user/billing-checkout', ({ request }) => {
      looked += 1;
      expect(new URL(request.url).searchParams.get('session_id')).toBe(SESSION);
      return HttpResponse.json({ status: 'complete', entitlement: PREMIUM });
    }));
    renderAt(`/premium/success?session_id=${SESSION}`, <PremiumSuccessPage />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Everything is open now.' })).toBeInTheDocument();
    expect(screen.getByText('Your plan: Premium, renews 12 Nov')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open the map' })).toBeInTheDocument();
    expect(looked).toBe(1);
  });

  it('needs no lookup when the webhook came first', async () => {
    signIn();
    serve({ plan: PREMIUM });
    server.use(http.get('*/api/user/billing-checkout', () => { throw new Error('no lookup expected'); }));
    renderAt(`/premium/success?session_id=${SESSION}`, <PremiumSuccessPage />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Everything is open now.' })).toBeInTheDocument();
  });

  it('waits for this checkout when a voucher already opened Premium', async () => {
    signIn();
    const VOUCHER = { ...PREMIUM, source: 'promo', currentPeriodEnd: null, validUntil: '2026-12-01T00:00:00.000Z' };
    serve({ plan: VOUCHER });
    let looked = 0;
    server.use(http.get('*/api/user/billing-checkout', () => {
      looked += 1;
      return HttpResponse.json({ status: 'pending', entitlement: VOUCHER });
    }));
    renderAt(`/premium/success?session_id=${SESSION}`, <PremiumSuccessPage />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Your payment is still processing' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Everything is open now.' })).toBeNull();
    expect(looked).toBe(1);
  });

  it('drops a lookup answered after the account changed, and asks again for the new one', async () => {
    signIn();
    serve();
    const asked: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((done) => { releaseFirst = done; });
    server.use(http.get('*/api/user/billing-checkout', async () => {
      asked.push(auth.value.user?.id ?? 'none');
      if (asked.length === 1) {
        await firstGate;
        return HttpResponse.json({ status: 'complete', entitlement: PREMIUM });
      }
      return HttpResponse.json({ error: { code: 'not_found', message: 'No such checkout' } }, { status: 404 });
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const tree = () => (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/premium/success?session_id=${SESSION}`]}>
          <LanguageProvider><PremiumSuccessPage /></LanguageProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
    const view = render(tree());
    await waitFor(() => expect(asked).toEqual(['user-1']));
    auth.value = { ...auth.value, user: { id: 'user-2' }, isAuthenticated: true };
    view.rerender(tree());
    expect(await screen.findByRole('heading', { level: 1, name: 'We could not find this checkout' })).toBeInTheDocument();
    await act(async () => { releaseFirst(); await new Promise((done) => setTimeout(done, 50)); });
    expect(screen.queryByRole('heading', { level: 1, name: 'Everything is open now.' })).toBeNull();
    expect(asked).toEqual(['user-1', 'user-2']);
  });

  it('says a payment is still processing and offers to check again', async () => {
    signIn();
    serve();
    server.use(http.get('*/api/user/billing-checkout', () => HttpResponse.json({ status: 'pending', entitlement: FREE })));
    renderAt(`/premium/success?session_id=${SESSION}`, <PremiumSuccessPage />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Your payment is still processing' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();
  });

  it('stops promising another check after the last automatic one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      signIn();
      serve();
      let looked = 0;
      server.use(http.get('*/api/user/billing-checkout', () => {
        looked += 1;
        return HttpResponse.json({ status: 'pending', entitlement: FREE });
      }));
      renderAt(`/premium/success?session_id=${SESSION}`, <PremiumSuccessPage />);
      expect(await screen.findByText('Not confirmed yet. We check again every few seconds.')).toBeInTheDocument();
      const verifyAnnouncement = trackAnnouncement('.ss-billing-status');
      for (let check = 2; check <= 6; check++) {
        await vi.advanceTimersByTimeAsync(4000);
        await waitFor(() => expect(looked).toBe(check));
      }
      expect(await screen.findByText('Still not confirmed. Press Check again, or open your profile in a few minutes.')).toBeInTheDocument();
      verifyAnnouncement('Still not confirmed.');
      await vi.advanceTimersByTimeAsync(20_000);
      expect(looked).toBe(6);
    } finally {
      vi.useRealTimers();
    }
  });

  it('offers to start again after an expired checkout, with the price', async () => {
    signIn();
    serve();
    server.use(http.get('*/api/user/billing-checkout', () => HttpResponse.json({ status: 'expired', entitlement: FREE })));
    renderAt(`/premium/success?session_id=${SESSION}`, <PremiumSuccessPage />);
    expect(await screen.findByRole('heading', { level: 1, name: 'This checkout expired' })).toBeInTheDocument();
    expect(screen.getByText('No payment was taken. €4.99 a month or €59.88 a year, before VAT. Cancel any time.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Continue with monthly' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with yearly' })).toBeInTheDocument();
  });

  it('treats another account’s or a missing checkout the same way', async () => {
    signIn();
    serve();
    server.use(http.get('*/api/user/billing-checkout', () => HttpResponse.json({ error: { code: 'not_found', message: 'No such checkout' } }, { status: 404 })));
    renderAt(`/premium/success?session_id=${SESSION}`, <PremiumSuccessPage />);
    expect(await screen.findByRole('heading', { level: 1, name: 'We could not find this checkout' })).toBeInTheDocument();
    renderAt('/premium/success', <PremiumSuccessPage />);
    expect(screen.getAllByRole('heading', { level: 1, name: 'We could not find this checkout' }).length).toBeGreaterThan(0);
  });

  it('asks a signed-out visitor to sign in with the paying account', async () => {
    serve();
    renderAt(`/premium/success?session_id=${SESSION}`, <PremiumSuccessPage />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in to finish' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });
});

describe('/premium/cancel', () => {
  const TOKEN = 'T'.repeat(43);
  const cancelApi = (answer: (body: Record<string, unknown>) => Response | Promise<Response>) => {
    const bodies: Array<Record<string, unknown>> = [];
    server.use(http.post('*/api/user/billing-cancel', async ({ request }) => {
      const body = await request.json() as Record<string, unknown>;
      bodies.push(body);
      return answer(body);
    }));
    return bodies;
  };

  it('takes two steps, then asks the address to confirm, and says nothing about a subscription', async () => {
    serve({ billing: { enabled: true, cancellable: true, cancelByEmail: true } });
    const bodies = cancelApi((body) => body.step === 'request'
      ? HttpResponse.json({ step: 'confirm', action: body.action, email: body.email })
      : HttpResponse.json({ received: true, confirmBy: 'email', action: body.action, email: body.email, receivedAt: '2026-09-25T14:32:00.000Z', expiresInMinutes: 60 }));
    renderAt('/premium/cancel', <PremiumCancelPage />);
    const email = await screen.findByLabelText(/Email address of your subscription/);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Enter the email address your subscription uses.')).toBeInTheDocument();
    fireEvent.change(email, { target: { value: 'payer@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const confirm = await screen.findByRole('button', { name: 'Cancel my subscription now' });
    // The step's effect moves focus after the render that shows it, so wait
    // for it rather than read it at the first frame the heading appears.
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Confirm your cancellation' })).toHaveFocus());
    expect(screen.getByText(/subscription of payer@example\.com\?/)).toBeInTheDocument();
    expect(screen.getByText('We will email a link to payer@example.com. Nothing changes until you open it.')).toBeInTheDocument();
    fireEvent.click(confirm);
    await screen.findByRole('heading', { level: 2, name: 'Check your email' });
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Check your email' })).toHaveFocus());
    expect(screen.getByText('We sent a confirmation link to payer@example.com. Open it within 60 minutes to finish. Until you do, nothing changes.')).toBeInTheDocument();
    expect(screen.getByText(/Received on 25 September 2026 at .* for payer@example\.com\./)).toBeInTheDocument();
    expect(screen.queryByText(/will not renew|refunded/)).toBeNull();
    expect(bodies.map((body) => body.step)).toEqual(['request', 'confirm']);
    expect(bodies.every((body) => body.action === 'cancel')).toBe(true);
  });

  it('sends one request and one confirmation for double presses', async () => {
    serve({ billing: { enabled: true, cancellable: true, cancelByEmail: true } });
    const bodies = cancelApi(async (body) => {
      await delay(20);
      return body.step === 'request'
        ? HttpResponse.json({ step: 'confirm' })
        : HttpResponse.json({ received: true, confirmBy: 'email', action: body.action, email: body.email, receivedAt: '2026-09-25T14:32:00.000Z', expiresInMinutes: 60 });
    });
    renderAt('/premium/cancel', <PremiumCancelPage />);
    fireEvent.change(await screen.findByLabelText(/Email address of your subscription/), { target: { value: 'payer@example.com' } });
    const next = screen.getByRole('button', { name: 'Continue' });
    act(() => { next.click(); next.click(); });
    const confirm = await screen.findByRole('button', { name: 'Cancel my subscription now' });
    act(() => { confirm.click(); confirm.click(); });
    await screen.findByRole('heading', { level: 2, name: 'Check your email' });
    expect(bodies.map((body) => body.step)).toEqual(['request', 'confirm']);
  });

  it('takes focus back to the email field when the address changes', async () => {
    serve();
    cancelApi((body) => HttpResponse.json({ step: 'confirm', action: body.action, email: body.email }));
    renderAt('/premium/cancel', <PremiumCancelPage />);
    fireEvent.change(await screen.findByLabelText(/Email address of your subscription/), { target: { value: 'payer@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Change the email' }));
    await waitFor(() => expect(screen.getByLabelText(/Email address of your subscription/)).toHaveFocus());
  });

  it('asks for the sign-in when the site cannot email a link', async () => {
    serve({ billing: { enabled: true, cancellable: true, cancelByEmail: false } });
    cancelApi((body) => body.step === 'request'
      ? HttpResponse.json({ step: 'confirm' })
      : HttpResponse.json({ received: false, confirmBy: 'sign-in', action: body.action, email: body.email }));
    renderAt('/premium/cancel', <PremiumCancelPage />);
    fireEvent.change(await screen.findByLabelText(/Email address of your subscription/), { target: { value: 'payer@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/This site cannot send the confirmation email yet\. To act on this address, sign in/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel my subscription now' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Sign in to finish' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows a signed-in owner exactly what happened, withdrawal included', async () => {
    serve();
    cancelApi((body) => body.step === 'request'
      ? HttpResponse.json({ step: 'confirm' })
      : HttpResponse.json({
        received: true, confirmed: true, action: body.action, email: body.email, receivedAt: '2026-09-25T14:32:00.000Z', emailed: true,
        details: [{ withdrawn: true, refunded: true, endsAt: '2026-09-25T14:32:00.000Z' }],
      }));
    renderAt('/premium/cancel?action=withdraw', <PremiumCancelPage />);
    fireEvent.change(await screen.findByLabelText(/Email address of your subscription/), { target: { value: 'payer@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/If your first payment was less than 14 days ago, the subscription ends now and we refund it in full, once per account\. Otherwise it stops renewing/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw from the contract' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'We received your withdrawal' })).toBeInTheDocument();
    expect(screen.getByText(/refunded your payment in full/)).toBeInTheDocument();
    expect(screen.getByText('We also sent these details to the address on the subscription.')).toBeInTheDocument();
  });

  it('opens the emailed link, takes the token out of the address and confirms once', async () => {
    serve();
    const bodies = cancelApi((body) => body.step === 'review'
      ? HttpResponse.json({ action: 'withdraw', email: 'payer@example.com', requestedAt: '2026-09-25T14:32:00.000Z', expiresAt: '2026-09-25T15:32:00.000Z' })
      : HttpResponse.json({
        received: true, confirmed: true, action: 'withdraw', email: 'payer@example.com', receivedAt: '2026-09-25T14:32:00.000Z', emailed: false,
        details: [{ withdrawn: false, refunded: false, endsAt: '2026-10-25T10:00:00.000Z' }],
      }));
    renderAt(`/premium/cancel#confirm=${TOKEN}`, <PremiumCancelPage />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Confirm your withdrawal' })).toBeInTheDocument();
    expect(screen.getByTestId('hash')).toHaveTextContent('');
    expect(screen.getByText(/Requested on 25 September 2026 at .* for payer@example\.com\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw from the contract' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'We received your withdrawal' })).toBeInTheDocument();
    expect(screen.getByText('Premium stays open until 25 October 2026. You will not be charged again.')).toBeInTheDocument();
    expect(bodies).toEqual([{ step: 'review', token: TOKEN }, { step: 'execute', token: TOKEN }]);
  });

  it('asks about the emailed link again on Try again, though the address no longer holds it', async () => {
    serve();
    let reviews = 0;
    const bodies = cancelApi(() => {
      reviews += 1;
      return reviews === 1
        ? HttpResponse.json({ error: { code: 'upstream_timeout', message: 'busy' } }, { status: 503 })
        : HttpResponse.json({ action: 'cancel', email: 'payer@example.com', requestedAt: '2026-09-25T14:32:00.000Z', expiresAt: '2026-09-25T15:32:00.000Z' });
    });
    renderAt(`/premium/cancel#confirm=${TOKEN}`, <PremiumCancelPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    const loading = screen.getByRole('heading', { level: 2, name: 'Checking your link' });
    expect(loading).toHaveFocus();
    expect(loading.closest('[aria-live], [role="status"]')).toBeNull();
    expect(await screen.findByRole('heading', { level: 2, name: 'Confirm your cancellation' })).toHaveFocus();
    expect(screen.getByTestId('hash')).toHaveTextContent('');
    expect(bodies).toEqual([{ step: 'review', token: TOKEN }, { step: 'review', token: TOKEN }]);
  });

  it('says so when a link has expired, and starts again', async () => {
    serve();
    cancelApi(() => HttpResponse.json({ error: { code: 'link_expired', message: 'This link has expired or was used already.' } }, { status: 410 }));
    renderAt(`/premium/cancel#confirm=${TOKEN}`, <PremiumCancelPage />);
    expect(await screen.findByRole('heading', { level: 2, name: 'This link no longer works' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
    await waitFor(() => expect(screen.getByLabelText(/Email address of your subscription/)).toHaveFocus());
  });

  it('says so when billing is not set up', async () => {
    serve({ billing: { enabled: false, cancellable: false } });
    renderAt('/premium/cancel', <PremiumCancelPage />);
    expect(await screen.findByText(/Billing is not set up on this site yet/)).toBeInTheDocument();
  });
});

describe('the plan line and the footer', () => {
  it('offers Manage billing for a paid subscription only, and leaves for the portal', async () => {
    signIn();
    serve({ plan: PREMIUM });
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, origin: original.origin, assign } });
    server.use(http.post('*/api/user/billing-portal', () => HttpResponse.json({ url: 'https://billing.stripe.com/p/session/test' })));
    try {
      renderAt('/profile', <PlanLine />);
      fireEvent.click(await screen.findByRole('button', { name: 'Manage billing' }));
      await waitFor(() => expect(assign).toHaveBeenCalledWith('https://billing.stripe.com/p/session/test'));
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });

  it('opens one portal session for a double press, on the plan line and on the checkout button', async () => {
    signIn();
    serve({ plan: PREMIUM });
    let portals = 0;
    server.use(http.post('*/api/user/billing-portal', async () => {
      portals += 1;
      await delay('infinite');
      return HttpResponse.json({ url: 'https://billing.stripe.com/p/session/test' });
    }));
    const line = renderAt('/profile', <PlanLine />);
    const manage = await screen.findByRole('button', { name: 'Manage billing' });
    act(() => { manage.click(); manage.click(); });
    await waitFor(() => expect(portals).toBe(1));
    line.unmount();
    renderAt('/premium', <PremiumCheckoutButton plan="monthly" />);
    const button = await screen.findByRole('button', { name: 'Manage billing' });
    await waitFor(() => expect(button).toBeEnabled());
    act(() => { button.click(); button.click(); });
    await waitFor(() => expect(portals).toBe(2));
    await new Promise((done) => setTimeout(done, 50));
    expect(portals).toBe(2);
  });

  it('makes Manage billing pressable again when Back restores the Profile from the browser cache', async () => {
    signIn();
    serve({ plan: PREMIUM });
    server.use(http.post('*/api/user/billing-portal', async () => { await delay('infinite'); return HttpResponse.json({ url: 'https://billing.stripe.com/p/session/test' }); }));
    renderAt('/profile', <PlanLine />);
    const manage = await screen.findByRole('button', { name: 'Manage billing' });
    fireEvent.click(manage);
    await waitFor(() => expect(manage).toBeDisabled());
    act(() => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
    await waitFor(() => expect(manage).toBeEnabled());
  });

  it('keeps Manage billing away from a complimentary grant without billing', async () => {
    signIn();
    serve({ plan: { ...PREMIUM, source: 'manual', currentPeriodEnd: null } });
    renderAt('/profile', <PlanLine />);
    expect(await screen.findByText('Premium, complimentary')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Manage billing' })).toBeNull();
  });

  it('keeps Manage billing for a subscription under a longer grant, and after it ended', async () => {
    signIn();
    serve({ plan: { ...PREMIUM, source: 'manual', currentPeriodEnd: null, billingAccount: true, subscriptionLive: true } });
    renderAt('/profile', <PlanLine />);
    expect(await screen.findByText('Premium, complimentary')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage billing' })).toBeInTheDocument();
    serve({ plan: { ...FREE, billingAccount: true, subscriptionLive: false } });
    renderAt('/profile', <PlanLine />);
    expect(await screen.findByText('Free')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Manage billing' }).length).toBeGreaterThan(0);
  });

  it('links the cancellation page from the footer when billing exists', async () => {
    serve();
    renderAt('/', <BrandFooter />);
    expect(await screen.findByRole('link', { name: 'Cancel Premium' })).toHaveAttribute('href', '/premium/cancel');
  });
});

describe('the checkout button', () => {
  const withLocation = async (run: (assign: ReturnType<typeof vi.fn>) => Promise<void>) => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, origin: original.origin, assign } });
    try { await run(assign); } finally { Object.defineProperty(window, 'location', { configurable: true, value: original }); }
  };

  it('is not there while billing is switched off', async () => {
    signIn();
    serve({ billing: { enabled: false, cancellable: false } });
    renderAt('/premium', <PremiumCheckoutButton plan="monthly" />);
    expect(await screen.findByText('Premium opens soon')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('opens checkout for the selected plan without creating an order before consent', async () => {
    signIn(); serve();
    const create = vi.fn();
    server.use(http.post('*/api/user/billing-checkout', () => { create(); return HttpResponse.json({}); }));
    renderAt('/premium', <PremiumCheckoutButton plan="annual" />);
    const button = await screen.findByRole('button', { name: 'Continue with yearly' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(await screen.findByTestId('location')).toHaveTextContent('/premium/checkout?plan=annual');
    expect(create).not.toHaveBeenCalled();
  });

  it('asks a visitor to sign in and a subscriber to manage billing', async () => {
    serve();
    renderAt('/premium', <PremiumCheckoutButton plan="monthly" />);
    expect(await screen.findByRole('button', { name: 'Continue with monthly' })).toHaveAttribute('aria-haspopup', 'dialog');
    signIn();
    serve({ plan: PREMIUM });
    renderAt('/premium', <PremiumCheckoutButton plan="monthly" />);
    expect(await screen.findByRole('button', { name: 'Manage billing' })).toBeInTheDocument();
  });

  // UX audit money-15: the plan label stays, and signing in goes on to this
  // plan's checkout rather than back to the page the button sits on.
  it('opens the sign-in dialog for a visitor, which goes on to this plan\'s checkout, and stays pressable', async () => {
    serve();
    renderAt('/premium?plan=annual', <PremiumCheckoutButton plan="monthly" />);
    const button = await screen.findByRole('button', { name: 'Continue with monthly' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(openSignIn).toHaveBeenCalledWith({ returnTo: '/premium/checkout?plan=monthly' });
    // Nothing left the page, so nothing waits for it to.
    expect(button).toBeEnabled();
  });

  it('is pressable again when Back restores the page from the browser cache', async () => {
    signIn();
    serve({ plan: PREMIUM });
    // The press leaves for Stripe; the page stays busy until the browser unloads it.
    server.use(http.post('*/api/user/*', async () => { await delay('infinite'); return HttpResponse.json({ url: 'https://checkout.stripe.com/c/pay/cs_test_x' }); }));
    renderAt('/premium', <PremiumCheckoutButton plan="monthly" />);
    const button = await screen.findByRole('button', { name: 'Manage billing' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    act(() => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false })); });
    expect(button).toBeDisabled();
    act(() => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
    await waitFor(() => expect(button).toBeEnabled());
  });

  it('sends a subscriber under a complimentary grant to the portal, not to a second checkout', async () => {
    signIn();
    serve({ plan: { ...PREMIUM, source: 'promo', currentPeriodEnd: null, billingAccount: true, subscriptionLive: true } });
    renderAt('/premium', <PremiumCheckoutButton plan="monthly" />);
    expect(await screen.findByRole('button', { name: 'Manage billing' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue with monthly' })).toBeNull();
  });

  it('sends an account whose subscription can still charge to the portal, though Premium closed', async () => {
    // Past the grace of a failed renewal, unpaid or paused: the plan reads
    // Free, and the server reports the subscription live (migration 053).
    signIn();
    serve({ plan: { ...FREE, billingAccount: true, subscriptionLive: true } });
    renderAt('/premium', <PremiumCheckoutButton plan="monthly" />);
    expect(await screen.findByRole('button', { name: 'Manage billing' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue with monthly' })).toBeNull();
  });
});
