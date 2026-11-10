// The pages a confirmation or password-reset email opens
// (components/auth/AuthPages.tsx). The real supabase-js reads the link from
// the address bar, as it does in production, against Supabase Auth answers
// from MSW (tests/mocks/gotrue.ts). Each test is a page load of its own.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from './mocks/server';
import { ANON_KEY, AUTH, PROJECT_URL, STORAGE_KEY, authError, emailUser, gotrueOk, sessionFor } from './mocks/gotrue';

const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
proto.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
proto.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };

interface Seen { method: string; path: string; query: Record<string, string>; body: Record<string, unknown> | null; authorization: string | null }
let seen: Seen[] = [];
const calls = (path: string) => seen.filter((one) => one.path === path);

const USER = emailUser();
const SESSION = sessionFor(USER, 'link-access-token');
const INJECTED_FRAGMENT = `#access_token=${SESSION.access_token}&expires_at=${SESSION.expires_at}&expires_in=3600&refresh_token=${SESSION.refresh_token}&token_type=bearer&type=signup`;

function emailReturn(path: string, recovery = false): string {
  localStorage.setItem(`${STORAGE_KEY}-code-verifier`, JSON.stringify(recovery ? 'test-verifier/recovery' : 'test-verifier'));
  return `${path}${path.includes('?') ? '&' : '?'}code=test-code`;
}
const EXPIRED = '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';

// supabase-js tells other tabs about a sign-in over a BroadcastChannel. Node
// has one, but it delivers a MessageEvent jsdom's EventTarget refuses, and
// every page load here would hear the ones before it.
let releaseDownload = () => {};
beforeEach(() => {
  vi.stubGlobal('BroadcastChannel', undefined);
  // A page load: supabase-js arrives a moment after the app's first render,
  // as its download does in a browser (lib/supabaseClient.ts).
  const download = new Promise<void>((resolve) => { releaseDownload = resolve; });
  vi.doMock('@supabase/supabase-js', async () => {
    await download;
    return vi.importActual('@supabase/supabase-js');
  });
  vi.stubEnv('VITE_SUPABASE_URL', PROJECT_URL);
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', ANON_KEY);
  vi.resetModules();
  seen = [];
  server.events.on('request:start', async ({ request }) => {
    const url = new URL(request.url);
    if (!url.href.startsWith(AUTH) && url.pathname !== '/api/user/authevent') return;
    const text = request.method === 'GET' ? '' : await request.clone().text();
    seen.push({
      method: request.method,
      path: url.href.startsWith(AUTH) ? url.pathname.replace('/auth/v1', '') : url.pathname,
      query: Object.fromEntries(url.searchParams),
      body: text ? JSON.parse(text) as Record<string, unknown> : null,
      authorization: request.headers.get('authorization'),
    });
  });
  server.use(
    http.get(`${AUTH}/user`, ({ request }) => request.headers.get('authorization') === `Bearer ${SESSION.access_token}`
      ? gotrueOk(USER)
      : authError(401, 'bad_jwt', 'invalid JWT')),
    http.post(`${AUTH}/token`, async ({ request }) => {
      const { auth_code, code_verifier } = await request.json() as Record<string, unknown>;
      return new URL(request.url).searchParams.get('grant_type') === 'pkce'
        && auth_code === 'test-code' && code_verifier === 'test-verifier'
        ? gotrueOk(SESSION)
        : authError(400, 'bad_code_verifier', 'invalid code or verifier');
    }),
    http.post('*/api/user/authevent', () => HttpResponse.json({ ok: true, kind: 'register' })),
  );
});

afterEach(() => {
  releaseDownload();
  server.events.removeAllListeners();
  vi.doUnmock('@supabase/supabase-js');
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

/** Opens `url` as a fresh page load: the address bar first, then the app's
 * modules, as the browser would. App's recovery redirect is reproduced by
 * rendering both pages under their routes, plus a home page. */
async function openPage(url: string) {
  window.history.replaceState(null, '', url);
  const [{ AuthProvider, useAuth }, { LanguageProvider }, pages, { default: SignInDialogHost }, { useAuthLanding }] = await Promise.all([
    import('../src/lib/auth'),
    import('../src/i18n/LanguageContext'),
    import('../src/components/auth/AuthPages'),
    import('../src/components/auth/SignInDialogHost'),
    import('../src/lib/authLanding'),
  ]);
  // App's moves once an account arrives.
  function Landing() {
    const { user, passwordRecovery } = useAuth();
    useAuthLanding(user, passwordRecovery);
    return null;
  }
  function Where() {
    const location = useLocation();
    return <output data-testid="where">{location.pathname + location.search}</output>;
  }
  render(
    <BrowserRouter>
      <LanguageProvider>
        <AuthProvider>
          <Routes>
            <Route path="/auth/confirmed" element={<pages.EmailConfirmedPage />} />
            <Route path="/reset-password" element={<pages.ResetPasswordPage />} />
            <Route path="*" element={<p>another page</p>} />
          </Routes>
          <SignInDialogHost />
          <Landing />
          <Where />
        </AuthProvider>
      </LanguageProvider>
    </BrowserRouter>,
  );
  await act(async () => releaseDownload());
}

/** The live message whose whole text matches (an address in it is a span). */
const status = (text: RegExp) => screen.findByText((_, element) => element?.getAttribute('role') === 'status' && text.test(element.textContent ?? ''));

const h1 = () => screen.findByRole('heading', { level: 1 });
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('auth redirect binding', () => {
  it('does not adopt bearer tokens delivered in an unsolicited URL fragment', async () => {
    await openPage(`/auth/confirmed${INJECTED_FRAGMENT}`);
    expect(await h1()).toHaveTextContent('Confirm your email');
    expect(calls('/user')).toHaveLength(0);
    expect(calls('/api/user/authevent')).toHaveLength(0);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe('/auth/confirmed', () => {
  it('signs the learner in from the link, says so, and goes back to the page that asked', async () => {
    await openPage(emailReturn('/auth/confirmed?next=%2Fplay%2FK7Q2AB'));
    expect(await h1()).toHaveTextContent('Your email is confirmed');
    expect(screen.getByText('You’re signed in as ada@example.com.')).toBeInTheDocument();
    // The usual first sign-in follows: the server hears of it like any other.
    await waitFor(() => expect(calls('/api/user/authevent')).toHaveLength(1));
    expect(calls('/api/user/authevent')[0].authorization).toBe(`Bearer ${SESSION.access_token}`);
    // The code exchange used this browser’s verifier and removed the code from the URL.
    expect(calls('/token')[0].body).toEqual({ auth_code: 'test-code', code_verifier: 'test-verifier' });
    expect(new URLSearchParams(window.location.search).has('code')).toBe(false);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toMatchObject({ access_token: SESSION.access_token });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/play/K7Q2AB');
  });

  it('never continues to another site', async () => {
    await openPage(emailReturn('/auth/confirmed?next=%2F%2Fevil.example%2Fx'));
    expect(await h1()).toHaveTextContent('Your email is confirmed');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/);
  });

  it('says a link expired or was used, and sends a new one or offers a sign-in', async () => {
    server.use(http.post(`${AUTH}/resend`, () => gotrueOk({})));
    await openPage(`/auth/confirmed?next=%2Fpremium${EXPIRED}`);
    expect(await h1()).toHaveTextContent('This confirmation link has expired');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    // The lead already says to ask for a new link: no second line in the card.
    expect(screen.queryByText('Didn’t get it? We’ll send a new link.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Send a new link' }));
    expect(screen.getByText('Enter your email address.')).toBeInTheDocument();
    // Focus goes to the field, which reads its message out with it.
    expect(screen.getByLabelText('Email')).toHaveFocus();
    type('Email', 'ada@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Send a new link' }));
    expect(await status(/still needs confirming/)).toHaveTextContent('If ada@example.com still needs confirming, a new link is on its way.');
    expect(calls('/resend')[0].body).toMatchObject({ type: 'signup', email: 'ada@example.com' });
    expect(calls('/resend')[0].query.redirect_to).toBe('http://localhost:3000/auth/confirmed?next=%2Fpremium');
    // Supabase sends one a minute: the button waits it out.
    expect(await screen.findByRole('button', { name: /^Send again in \d+s$/ })).toBeDisabled();
  });

  it('opens the sign-in dialog from Sign in', async () => {
    await openPage('/auth/confirmed');
    expect(await h1()).toHaveTextContent('Confirm your email');
    // One sign-in prompt (UX audit shell-public-04): not in the lead, and a
    // text link inside the card under the resend form, not a button above it.
    expect(screen.queryByText(/Already did\?/)).toBeNull();
    const signIn = screen.getByRole('button', { name: 'Sign in' });
    expect(signIn.closest('p')).toHaveTextContent('Already confirmed? Sign in');
    const send = screen.getByRole('button', { name: 'Send a new link' });
    expect(send.compareDocumentPosition(signIn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(signIn.closest('.ss-auth-page')).toBe(send.closest('.ss-auth-page'));
    // One short line above the field instead of a heading (shell-public-14).
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    const card = screen.getByRole('region', { name: 'Confirm your email' });
    expect(card).toHaveTextContent(/^Didn’t get it\? We’ll send a new link\./);
    fireEvent.click(signIn);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('confirms a scanner-safe link only when the learner presses the button', async () => {
    server.use(http.post(`${AUTH}/verify`, () => gotrueOk(SESSION)));
    await openPage('/auth/confirmed?token_hash=pkce_0123456789abcdef&type=email');
    expect(await h1()).toHaveTextContent('Confirm your email');
    // A mail filter that fetched the page ran no script and pressed nothing.
    expect(calls('/verify')).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm my email' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Your email is confirmed' })).toBeInTheDocument();
    expect(calls('/verify')[0].body).toMatchObject({ token_hash: 'pkce_0123456789abcdef', type: 'email' });
  });

  it('says so when a scanner-safe link has expired', async () => {
    server.use(http.post(`${AUTH}/verify`, () => authError(403, 'otp_expired', 'Email link is invalid or has expired')));
    await openPage('/auth/confirmed?token_hash=pkce_0123456789abcdef&type=email');
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm my email' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'This confirmation link has expired' })).toBeInTheDocument();
  });
});

describe('/reset-password', () => {
  it('sets a new password from a reset link, checks both fields, and signs other devices out', async () => {
    server.use(
      http.put(`${AUTH}/user`, async ({ request }) => {
        const body = await request.json() as { password?: string };
        return gotrueOk({ ...USER, updated_at: '2026-10-01T09:05:00Z', ...(body.password ? {} : {}) });
      }),
      http.post(`${AUTH}/logout`, () => new HttpResponse(null, { status: 204 })),
    );
    await openPage(emailReturn('/reset-password', true));
    expect(await screen.findByRole('heading', { level: 1, name: 'Set a new password' })).toBeInTheDocument();
    expect(screen.getByText('Choose a new password for ada@example.com.')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByLabelText('Confirm new password')).toHaveAttribute('autocomplete', 'new-password');

    type('New password', 'short');
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(screen.getByText('Use at least 8 characters.')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveFocus();
    type('New password', 'a much longer passphrase');
    type('Confirm new password', 'a much longer passphrasf');
    expect(screen.getByText('The two passwords don’t match.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(screen.getByLabelText('Confirm new password')).toHaveFocus();
    expect(calls('/user').filter((one) => one.method === 'PUT')).toEqual([]);

    type('Confirm new password', 'a much longer passphrase');
    const save = screen.getByRole('button', { name: 'Save new password' });
    save.focus();
    fireEvent.click(save);
    expect(await screen.findByRole('heading', { level: 1, name: 'Your password is changed' })).toHaveFocus();
    expect(screen.getByText('Any other device that was signed in to this account is now signed out.')).toBeInTheDocument();
    const update = calls('/user').find((one) => one.method === 'PUT')!;
    expect(update.body).toMatchObject({ password: 'a much longer passphrase' });
    expect(update.authorization).toBe(`Bearer ${SESSION.access_token}`);
    expect(calls('/logout')[0].query).toEqual({ scope: 'others' });
    // A reset link is a sign-in too.
    expect(calls('/api/user/authevent')).toHaveLength(1);
  });

  it('says a password was changed only to the account that changed it', async () => {
    const OTHER = emailUser({ id: '6b1c2a54-0000-4000-8000-0000000000e2', email: 'grace@example.com' });
    server.use(
      http.put(`${AUTH}/user`, () => gotrueOk({ ...USER, updated_at: '2026-10-01T09:05:00Z' })),
      http.post(`${AUTH}/logout`, () => new HttpResponse(null, { status: 204 })),
      http.post(`${AUTH}/token`, ({ request }) => {
        if (new URL(request.url).searchParams.get('grant_type') === 'password') {
          return gotrueOk(sessionFor(OTHER, 'other-access-token'));
        }
      }),
    );
    await openPage(emailReturn('/reset-password', true));
    await screen.findByRole('heading', { level: 1, name: 'Set a new password' });
    type('New password', 'a much longer passphrase');
    type('Confirm new password', 'a much longer passphrase');
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Your password is changed' })).toBeInTheDocument();
    // The account signs out on this page, and another signs in on it.
    const { loadedSupabase } = await import('../src/lib/supabaseClient');
    await act(async () => { await loadedSupabase()!.auth.signOut({ scope: 'local' }); });
    expect(await screen.findByRole('heading', { level: 1, name: 'Reset your password' })).toBeInTheDocument();
    await act(async () => { await loadedSupabase()!.auth.signInWithPassword({ email: 'grace@example.com', password: 'correct horse battery' }); });
    expect(await screen.findByRole('heading', { level: 1, name: 'Change your password' })).toBeInTheDocument();
    expect(screen.getByText('Choose a new password for grace@example.com.')).toBeInTheDocument();
  });

  it('says so when the new password is the old one', async () => {
    server.use(http.put(`${AUTH}/user`, () => authError(422, 'same_password', 'New password should be different from the old password.')));
    await openPage(emailReturn('/reset-password', true));
    await h1();
    type('New password', 'a much longer passphrase');
    type('Confirm new password', 'a much longer passphrase');
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That’s your current password. Choose a new one.');
  });

  it('asks for a link when nobody is signed in, without saying whether the address has an account', async () => {
    server.use(http.post(`${AUTH}/recover`, () => gotrueOk({})));
    await openPage('/reset-password');
    expect(await h1()).toHaveTextContent('Reset your password');
    // The card states its action once, on its button (UX audit
    // shell-public-14): no heading of its own; it takes the h1 as its name.
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    expect(screen.getByRole('region', { name: 'Reset your password' })).toContainElement(screen.getByRole('button', { name: 'Send reset link' }));
    // The live region is on the page, empty, before it has anything to say:
    // one that arrives with its words is not read out.
    const region = screen.getAllByRole('status').find((element) => element.classList.contains('ss-auth__status'));
    expect(region).toBeEmptyDOMElement();
    type('Email', 'ada@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await status(/has a devShark account/)).toHaveTextContent('If ada@example.com has a devShark account, we sent it a link to set a new password.');
    expect(await status(/has a devShark account/)).toBe(region);
    expect(calls('/recover')[0].query.redirect_to).toBe('http://localhost:3000/reset-password');
  });

  it('says a reset link expired, and asks for a new one', async () => {
    await openPage(`/reset-password${EXPIRED}`);
    expect(await h1()).toHaveTextContent('This reset link has expired');
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeInTheDocument();
  });

  it('opens a scanner-safe reset link on Continue', async () => {
    server.use(http.post(`${AUTH}/verify`, () => gotrueOk(SESSION)));
    await openPage('/reset-password?token_hash=pkce_0123456789abcdef&type=recovery');
    expect(await h1()).toHaveTextContent('Reset your password');
    expect(calls('/verify')).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Set a new password' })).toBeInTheDocument();
    expect(calls('/verify')[0].body).toMatchObject({ token_hash: 'pkce_0123456789abcdef', type: 'recovery' });
  });

  it('refuses a link type meant for another page', async () => {
    await openPage('/reset-password?token_hash=pkce_0123456789abcdef&type=signup');
    expect(await h1()).toHaveTextContent('Reset your password');
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(calls('/verify')).toEqual([]);
  });
});

describe('a press that lands twice on an email-link page', () => {
  // A double click, or Enter twice: both presses run before React draws the
  // first one's busy state.
  const twice = (control: () => HTMLElement, submit = true) => act(() => {
    const element = control();
    const target = submit ? element.closest('form')! : element;
    const fire = submit ? fireEvent.submit : fireEvent.click;
    fire(target);
    fire(target);
  });

  it('sends one email', async () => {
    server.use(http.post(`${AUTH}/recover`, () => gotrueOk({})));
    await openPage('/reset-password');
    await h1();
    type('Email', 'ada@example.com');
    twice(() => screen.getByRole('button', { name: 'Send reset link' }));
    await status(/has a devShark account/);
    expect(calls('/recover')).toHaveLength(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('opens a scanner-safe link once', async () => {
    server.use(http.post(`${AUTH}/verify`, () => gotrueOk(SESSION)));
    await openPage('/auth/confirmed?token_hash=pkce_0123456789abcdef&type=email');
    await h1();
    twice(() => screen.getByRole('button', { name: 'Confirm my email' }), false);
    expect(await screen.findByRole('heading', { level: 1, name: 'Your email is confirmed' })).toBeInTheDocument();
    expect(calls('/verify')).toHaveLength(1);
  });

  it('sets the new password once', async () => {
    server.use(
      http.put(`${AUTH}/user`, () => gotrueOk({ ...USER, updated_at: '2026-10-01T09:05:00Z' })),
      http.post(`${AUTH}/logout`, () => new HttpResponse(null, { status: 204 })),
    );
    await openPage(emailReturn('/reset-password', true));
    await screen.findByRole('heading', { level: 1, name: 'Set a new password' });
    type('New password', 'a much longer passphrase');
    type('Confirm new password', 'a much longer passphrase');
    twice(() => screen.getByRole('button', { name: 'Save new password' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Your password is changed' })).toBeInTheDocument();
    expect(calls('/user').filter((one) => one.method === 'PUT')).toHaveLength(1);
  });
});

describe('a scanner-safe link opened where another account is signed in', () => {
  // A shared computer: ada is signed in, and grace opens the link her email
  // sent her. The link is grace's, so the page opens it, as supabase-js opens
  // a link that lands with its session in the address.
  const GRACE = emailUser({ id: '6b1c2a54-0000-4000-8000-0000000000e2', email: 'grace@example.com' });
  const signedInAsAda = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(SESSION));

  it('confirms the link’s own account instead of saying the one signed in is confirmed', async () => {
    server.use(http.post(`${AUTH}/verify`, () => gotrueOk(sessionFor(GRACE, 'grace-access-token'))));
    signedInAsAda();
    await openPage('/auth/confirmed?token_hash=pkce_0123456789abcdef&type=email');
    expect(await h1()).toHaveTextContent('Confirm your email');
    expect(screen.queryByText(/ada@example\.com/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm my email' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Your email is confirmed' })).toBeInTheDocument();
    expect(screen.getByText('You’re signed in as grace@example.com.')).toBeInTheDocument();
    expect(calls('/verify')).toHaveLength(1);
  });

  it('opens the reset link instead of offering to change the password of the account signed in', async () => {
    server.use(http.post(`${AUTH}/verify`, () => gotrueOk(sessionFor(GRACE, 'grace-access-token'))));
    signedInAsAda();
    await openPage('/reset-password?token_hash=pkce_0123456789abcdef&type=recovery');
    expect(await h1()).toHaveTextContent('Reset your password');
    expect(screen.queryByLabelText('New password')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Set a new password' })).toBeInTheDocument();
    expect(screen.getByText('Choose a new password for grace@example.com.')).toBeInTheDocument();
  });

  it('says a refused link expired, without changing the account signed in', async () => {
    server.use(http.post(`${AUTH}/verify`, () => authError(403, 'otp_expired', 'Email link is invalid or has expired')));
    signedInAsAda();
    await openPage('/reset-password?token_hash=pkce_0123456789abcdef&type=recovery');
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'This reset link has expired' })).toBeInTheDocument();
    expect(screen.queryByLabelText('New password')).toBeNull();
  });
});

describe('where the app shell sends a learner from an email link', () => {
  it('opens the new-password form when a reset link lands on the home page', async () => {
    // Supabase sends the link to the Site URL when /reset-password is not on
    // its redirect allow-list.
    await openPage(emailReturn('/', true));
    expect(await screen.findByRole('heading', { level: 1, name: 'Set a new password' })).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/reset-password');
  });

  it('keeps the learner on the confirmation page, whatever an older sign-in meant to return to', async () => {
    sessionStorage.setItem('devshark:auth-return', JSON.stringify({ path: '/premium', at: Date.now() }));
    await openPage(emailReturn('/auth/confirmed'));
    expect(await h1()).toHaveTextContent('Your email is confirmed');
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(screen.getByTestId('where')).toHaveTextContent('/auth/confirmed');
    // The stale return is used up, so it steers no later sign-in either.
    expect(sessionStorage.getItem('devshark:auth-return')).toBeNull();
  });
});
