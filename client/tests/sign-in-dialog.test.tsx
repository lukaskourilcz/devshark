// The sign-in dialog (components/auth/SignInDialog.tsx): Google first, then
// an email and password that sign in, create an account or send a reset link.
// The real supabase-js runs against Supabase Auth answers from MSW
// (tests/mocks/gotrue.ts), so every error below reaches the dialog the way
// production's would. Each test loads the modules afresh, as a page load does.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from './mocks/server';
import { ANON_KEY, AUTH, PROJECT_URL, authError, emailUser, gotrueOk, sessionFor } from './mocks/gotrue';

// jsdom has no modal dialogs; the sign-in dialog opens one.
const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
proto.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
proto.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };

interface Seen { path: string; query: Record<string, string>; body: Record<string, unknown> | null; authorization: string | null }
let seen: Seen[] = [];
/** Records every request to Supabase Auth and to the sign-in log. */
function record() {
  seen = [];
  server.events.on('request:start', async ({ request }) => {
    const url = new URL(request.url);
    if (!url.href.startsWith(AUTH) && url.pathname !== '/api/user/authevent') return;
    const text = request.method === 'GET' ? '' : await request.clone().text();
    seen.push({
      path: url.href.startsWith(AUTH) ? url.pathname.replace('/auth/v1', '') : url.pathname,
      query: Object.fromEntries(url.searchParams),
      body: text ? JSON.parse(text) as Record<string, unknown> : null,
      authorization: request.headers.get('authorization'),
    });
  });
}
const calls = (path: string) => seen.filter((one) => one.path === path);

beforeEach(() => {
  // supabase-js tells other tabs about a sign-in over a BroadcastChannel, and
  // Node's delivers events jsdom refuses (tests/auth-pages.test.tsx).
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.stubEnv('VITE_SUPABASE_URL', PROJECT_URL);
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', ANON_KEY);
  vi.resetModules();
  window.history.replaceState(null, '', '/premium');
  server.use(http.post('*/api/user/authevent', () => HttpResponse.json({ ok: true, kind: 'register' })));
  record();
});

afterEach(() => {
  server.events.removeAllListeners();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.doUnmock('@supabase/supabase-js');
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

/** The app's providers, the dialog host, and a line saying who is signed in;
 * then the dialog opened the way a page's "Log in" opens it. */
async function openDialog(detail: { view?: 'signIn' | 'signUp' | 'forgot'; returnTo?: string; email?: string } = {}, reactStrictMode = false) {
  const [{ AuthProvider, useAuth }, { LanguageProvider }, { default: SignInDialogHost }, store] = await Promise.all([
    import('../src/lib/auth'),
    import('../src/i18n/LanguageContext'),
    import('../src/components/auth/SignInDialogHost'),
    import('../src/lib/signInDialog'),
  ]);
  // Like the app's header: "Log in" only while nobody is signed in.
  function Header() {
    const { user } = useAuth();
    return user ? null : <button type="button">Opener</button>;
  }
  function Who() {
    const { user } = useAuth();
    return <p data-testid="who">{user ? `user:${user.email}` : 'signed-out'}</p>;
  }
  render(
    <MemoryRouter initialEntries={['/premium']}>
      <LanguageProvider>
        <AuthProvider>
          <Header />
          <main id="main-content" tabIndex={-1} />
          <SignInDialogHost />
          <Who />
        </AuthProvider>
      </LanguageProvider>
    </MemoryRouter>,
    { reactStrictMode },
  );
  screen.getByRole('button', { name: 'Opener' }).focus();
  act(() => store.openSignIn(detail));
  const dialog = await screen.findByRole('dialog');
  return { dialog, store };
}

const field = (dialog: HTMLElement, name: string) => within(dialog).getByLabelText(name) as HTMLInputElement;
const type = (input: HTMLElement, value: string) => fireEvent.change(input, { target: { value } });
const press = (dialog: HTMLElement, name: string | RegExp) => fireEvent.click(within(dialog).getByRole('button', { name }));
/** A paragraph by its whole text: the address in it is a span of its own. */
const paragraph = (dialog: HTMLElement, text: RegExp) => within(dialog).getByText((_, element) => element?.tagName === 'P' && text.test(element.textContent ?? ''));
const signUpTab = (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole('radio', { name: 'Create account' }));
/** The dialog has one title in both modes; the segmented control says which
 * mode is open (UX audit shell-public-05). */
const expectMode = (dialog: HTMLElement, mode: 'Sign in' | 'Create account') => {
  expect(within(dialog).getByRole('heading', { name: 'Your devShark account' })).toBeInTheDocument();
  expect(within(dialog).getByRole('radio', { name: mode })).toBeChecked();
};

describe('the sign-in dialog', () => {
  it('puts Google first, then the email form, with the fields password managers expect', async () => {
    const { dialog } = await openDialog();
    expectMode(dialog, 'Sign in');
    const google = within(dialog).getByRole('button', { name: 'Continue with Google' });
    const email = field(dialog, 'Email');
    const password = field(dialog, 'Password');
    // Google, then the form: Google comes first in reading and tab order.
    expect(google.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(dialog).getByText('or')).toBeInTheDocument();
    expect(email).toHaveAttribute('type', 'email');
    expect(email).toHaveAttribute('autocomplete', 'email');
    expect(email).toHaveAttribute('autocapitalize', 'none');
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
    // 'Forgot password?' sits in the row reserved under the password, as a
    // quiet note-sized link, not a third 'Sign in'-weight control.
    const forgot = within(dialog).getByRole('button', { name: 'Forgot password?' });
    expect(forgot.closest('.ss-auth__password')).toContainElement(password);
    expect(forgot.closest('p')).toHaveClass('ss-auth__forgot');
    expect(within(dialog).getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
    expect(within(dialog).getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');

    // Create account asks for a new password, and says the rule.
    signUpTab(dialog);
    expectMode(dialog, 'Create account');
    expect(field(dialog, 'Password')).toHaveAttribute('autocomplete', 'new-password');
    expect(within(dialog).getByText('At least 8 characters.')).toBeInTheDocument();
    // The rule takes the row 'Forgot password?' holds in Sign in: the same
    // reserved row under the password in both modes, so nothing moves.
    expect(within(dialog).getByText('At least 8 characters.').closest('.ss-auth__password')).toContainElement(field(dialog, 'Password'));
    expect(within(dialog).queryByRole('button', { name: 'Forgot password?' })).toBeNull();

    // Show password is one toggle button, pressed or not.
    const toggle = within(dialog).getByRole('button', { name: 'Show password' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(field(dialog, 'Password')).toHaveAttribute('type', 'text');
    // Nothing loaded supabase-js or asked Supabase anything yet.
    expect(seen).toEqual([]);
  });

  // UX audit U1 (#573): the dialog's actions are page actions (44px, 16px
  // text, through .ss-action and the shared .astryx-button floor), and its
  // close button is an Astryx button, so the same floor makes it 44x44 on a
  // mouse too (tests/touch-and-motion.test.ts holds the floor).
  it('draws Google and the submit as page actions and closes with a floored button', async () => {
    const { dialog } = await openDialog();
    expect(within(dialog).getByRole('button', { name: 'Continue with Google' })).toHaveClass('astryx-button', 'ss-action');
    const submit = dialog.querySelector('button[type="submit"]');
    expect(submit).toHaveClass('astryx-button', 'ss-action');
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveClass('astryx-button');
    for (const tab of within(dialog).getAllByRole('radio')) expect(tab.closest('.astryx-segmented-control-item')).not.toBeNull();
  });

  it('checks the fields before asking Supabase, and says what is wrong under each', async () => {
    const { dialog } = await openDialog();
    press(dialog, 'Sign in');
    expect(within(dialog).getByText('Enter your email address.')).toBeInTheDocument();
    expect(field(dialog, 'Email')).toHaveFocus();
    expect(field(dialog, 'Email')).toHaveAttribute('aria-invalid', 'true');
    expect(field(dialog, 'Email')).toHaveAccessibleDescription('Enter your email address.');

    type(field(dialog, 'Email'), 'ada@example');
    expect(within(dialog).getByText('Enter an email address like name@example.com.')).toBeInTheDocument();
    type(field(dialog, 'Email'), 'ada@example.com');
    press(dialog, 'Sign in');
    expect(within(dialog).getByText('Enter a password.')).toBeInTheDocument();
    expect(field(dialog, 'Password')).toHaveFocus();

    // A new password needs eight characters and fits in 72 bytes.
    signUpTab(dialog);
    type(field(dialog, 'Password'), 'short7!');
    press(dialog, 'Create account');
    expect(within(dialog).getByText('Use at least 8 characters.')).toBeInTheDocument();
    type(field(dialog, 'Password'), 'x'.repeat(73));
    expect(within(dialog).getByText('Use at most 72 characters.')).toBeInTheDocument();
    expect(seen).toEqual([]);
  });

  it('shows a format problem when the learner leaves the field, not while it is empty', async () => {
    const { dialog } = await openDialog();
    fireEvent.blur(field(dialog, 'Email'));
    expect(within(dialog).queryByText('Enter your email address.')).toBeNull();
    type(field(dialog, 'Email'), 'not-an-address');
    fireEvent.blur(field(dialog, 'Email'));
    expect(within(dialog).getByText('Enter an email address like name@example.com.')).toBeInTheDocument();
  });

  it('signs in with an email and password, closes, reports the sign-in and keeps the page to return to', async () => {
    const user = emailUser();
    server.use(http.post(`${AUTH}/token`, () => gotrueOk(sessionFor(user))));
    const { dialog } = await openDialog({ returnTo: '/premium?plan=annual' });
    type(field(dialog, 'Email'), '  ada@example.com ');
    type(field(dialog, 'Password'), 'correct horse battery');
    press(dialog, 'Sign in');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('who')).toHaveTextContent('user:ada@example.com');
    const token = calls('/token')[0];
    expect(token.query).toEqual({ grant_type: 'password' });
    expect(token.body).toMatchObject({ email: 'ada@example.com', password: 'correct horse battery' });
    // The app shell goes to the page that asked (lib/authReturn.ts).
    expect(JSON.parse(sessionStorage.getItem('devshark:auth-return') ?? '{}')).toMatchObject({ path: '/premium?plan=annual' });
    await waitFor(() => expect(calls('/api/user/authevent')).toHaveLength(1));
    expect(calls('/api/user/authevent')[0].authorization).toBe('Bearer access-token-email');
    // Said to a screen reader; the header shows it to everyone else.
    expect(screen.getByText('You’re signed in.')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('says when the email and password do not match, and keeps no return path', async () => {
    server.use(http.post(`${AUTH}/token`, () => authError(400, 'invalid_credentials', 'Invalid login credentials')));
    const { dialog } = await openDialog({ returnTo: '/premium?plan=annual' });
    type(field(dialog, 'Email'), 'ada@example.com');
    type(field(dialog, 'Password'), 'wrong password');
    press(dialog, 'Sign in');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('That email and password don’t match an account. Check them, or continue with Google if that’s how you signed up.');
    expect(screen.getByTestId('who')).toHaveTextContent('signed-out');
    expect(sessionStorage.getItem('devshark:auth-return')).toBeNull();
    // Typing again clears the old message.
    type(field(dialog, 'Password'), 'another try');
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  it('shows an asynchronous sign-in error and allows a retry in Strict Mode', async () => {
    server.use(http.post(`${AUTH}/token`, () => authError(400, 'invalid_credentials', 'Invalid login credentials')));
    const { dialog } = await openDialog({}, true);
    type(field(dialog, 'Email'), 'ada@example.com');
    type(field(dialog, 'Password'), 'wrong password');
    press(dialog, 'Sign in');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('That email and password don’t match an account.');
    expect(within(dialog).getByRole('button', { name: 'Sign in' })).toBeEnabled();
    press(dialog, 'Sign in');
    await waitFor(() => expect(calls('/token')).toHaveLength(2));
  });

  it('offers to send the confirmation again to an address nobody confirmed', async () => {
    server.use(
      http.post(`${AUTH}/token`, () => authError(400, 'email_not_confirmed', 'Email not confirmed')),
      http.post(`${AUTH}/resend`, () => gotrueOk({})),
    );
    const { dialog } = await openDialog();
    type(field(dialog, 'Email'), 'ada@example.com');
    type(field(dialog, 'Password'), 'correct horse battery');
    press(dialog, 'Sign in');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Confirm your email address first: open the link we sent when you created the account.');
    press(dialog, 'Resend confirmation email');
    expect(await within(dialog).findByRole('heading', { name: 'Check your inbox' })).toBeInTheDocument();
    expect(calls('/resend')[0].body).toMatchObject({ type: 'signup', email: 'ada@example.com' });
    // Back to the page the dialog was opened on.
    expect(calls('/resend')[0].query.redirect_to).toBe('http://localhost:3000/auth/confirmed?next=%2Fpremium');
  });

  it('creates an account, says where the link went, and sends it again only after a minute', async () => {
    server.use(
      http.post(`${AUTH}/signup`, () => gotrueOk(emailUser({ confirmed: false }))),
      http.post(`${AUTH}/resend`, () => gotrueOk({})),
    );
    const { dialog } = await openDialog({ view: 'signUp', returnTo: '/play/K7Q2AB' });
    type(field(dialog, 'Email'), 'ada@example.com');
    type(field(dialog, 'Password'), 'correct horse battery');
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    press(dialog, 'Create account');
    expect(await within(dialog).findByRole('heading', { name: 'Check your inbox' })).toBeInTheDocument();
    const signup = calls('/signup')[0];
    expect(signup.body).toMatchObject({ email: 'ada@example.com', password: 'correct horse battery' });
    expect(signup.query.redirect_to).toBe('http://localhost:3000/auth/confirmed?next=%2Fplay%2FK7Q2AB');
    // Nobody is signed in until the link is opened.
    expect(screen.getByTestId('who')).toHaveTextContent('signed-out');
    const lead = paragraph(dialog, /We sent a confirmation link to/);
    expect(lead).toHaveTextContent('We sent a confirmation link to ada@example.com. Open it, on this device or another, to finish creating your account.');
    expect(lead).toHaveFocus();

    const resend = within(dialog).getByRole('button', { name: 'Send again in 60s' });
    expect(resend).toBeDisabled();
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(within(dialog).getByRole('button', { name: 'Send again in 30s' })).toBeDisabled();
    act(() => { vi.advanceTimersByTime(30_000); });
    const ready = within(dialog).getByRole('button', { name: 'Send the email again' });
    expect(ready).toBeEnabled();
    // The live region waits on the page, empty: one that arrives with its
    // words is not read out.
    const region = within(dialog).getAllByRole('status').find((element) => element.classList.contains('ss-auth__status'));
    expect(region).toBeEmptyDOMElement();
    fireEvent.click(ready);
    expect(await within(dialog).findByText('Sent again. Check your inbox.')).toHaveAttribute('role', 'status');
    expect(within(dialog).getByText('Sent again. Check your inbox.')).toBe(region);
    expect(calls('/resend')[0].body).toMatchObject({ type: 'signup', email: 'ada@example.com' });
    expect(within(dialog).getByRole('button', { name: 'Send again in 60s' })).toBeDisabled();

    // Another address: back to the form, with the one typed so far.
    press(dialog, 'Use a different email');
    expectMode(dialog, 'Create account');
    expect(field(dialog, 'Email')).toHaveValue('ada@example.com');
    expect(field(dialog, 'Email')).toHaveFocus();
  });

  it('says an account already exists, and offers to sign in or reset the password', async () => {
    // Supabase answers an address with a confirmed account with a user that
    // has no identities, and sends nothing.
    server.use(http.post(`${AUTH}/signup`, () => gotrueOk({ ...emailUser({ confirmed: false }), identities: [] })));
    const { dialog } = await openDialog({ view: 'signUp' });
    type(field(dialog, 'Email'), 'ada@example.com');
    type(field(dialog, 'Password'), 'correct horse battery');
    press(dialog, 'Create account');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('An account with this email already exists. Sign in, or reset your password if you’ve forgotten it.');
    press(dialog, 'Sign in instead');
    expectMode(dialog, 'Sign in');
    expect(field(dialog, 'Email')).toHaveValue('ada@example.com');
    expect(field(dialog, 'Email')).toHaveFocus();
    expect(within(dialog).queryByRole('alert')).toBeNull();

    signUpTab(dialog);
    type(field(dialog, 'Password'), 'correct horse battery');
    press(dialog, 'Create account');
    await within(dialog).findByRole('alert');
    press(dialog, 'Reset password');
    expect(within(dialog).getByRole('heading', { name: 'Reset your password' })).toBeInTheDocument();
    expect(field(dialog, 'Email')).toHaveValue('ada@example.com');
  });

  it.each([
    [['length'], 'Choose a stronger password: at least 8 characters, and not one you use on other sites.'],
    [['characters'], 'Choose a stronger password: at least 8 characters, and not one you use on other sites.'],
    [['pwned'], 'This password has appeared in a data breach on another site. Choose a different one.'],
  ])('explains a password Supabase refuses (%j)', async (reasons, message) => {
    server.use(http.post(`${AUTH}/signup`, () => authError(422, 'weak_password', 'Password is known to be weak and easy to guess, please choose a different one.', { weak_password: { reasons } })));
    const { dialog } = await openDialog({ view: 'signUp' });
    type(field(dialog, 'Email'), 'ada@example.com');
    type(field(dialog, 'Password'), 'password1234');
    press(dialog, 'Create account');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(message);
  });

  it.each([
    ['too many sign-in attempts', '/token', 'signIn', () => authError(429, 'over_request_rate_limit', 'Request rate limit reached'), 'Too many attempts. Wait a minute, then try again.'],
    ['too many emails', '/signup', 'signUp', () => authError(429, 'over_email_send_rate_limit', 'email rate limit exceeded'), 'We’ve already sent emails to this address. Wait a few minutes before asking for another.'],
    ['no connection', '/token', 'signIn', () => HttpResponse.error(), 'We couldn’t reach the sign-in service. Check your connection and try again.'],
    ['a gateway that answers 503', '/token', 'signIn', () => HttpResponse.json({ message: 'upstream' }, { status: 503 }), 'The sign-in service had a problem. Try again in a few minutes.'],
    ['a failure on Supabase’s side', '/signup', 'signUp', () => authError(500, 'unexpected_failure', 'Error sending confirmation email'), 'The sign-in service had a problem. Try again in a few minutes.'],
    ['email sign-ups switched off', '/signup', 'signUp', () => authError(422, 'signup_disabled', 'Signups not allowed for this instance'), 'Email sign-in is switched off right now. Continue with Google instead.'],
    ['an address Supabase will not use', '/signup', 'signUp', () => authError(400, 'email_address_invalid', 'Email address "ada@example.invalid" is invalid'), 'This email address can’t be used. Check it for typos, or use another one.'],
    ['an address Supabase cannot read', '/signup', 'signUp', () => authError(400, 'validation_failed', 'Unable to validate email address: invalid format'), 'This email address can’t be used. Check it for typos, or use another one.'],
    ['a resend inside Supabase’s minute', '/signup', 'signUp', () => authError(429, 'over_email_send_rate_limit', 'For security purposes, you can only request this after 59 seconds.'), 'We’ve already sent emails to this address. Wait a few minutes before asking for another.'],
  ] as const)('says so on %s', async (_label, path, view, answer, message) => {
    server.use(http.post(`${AUTH}${path}`, answer));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { dialog } = await openDialog({ view });
    type(field(dialog, 'Email'), 'ada@example.com');
    type(field(dialog, 'Password'), 'correct horse battery');
    press(dialog, view === 'signUp' ? 'Create account' : 'Sign in');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByTestId('who')).toHaveTextContent('signed-out');
  });

  it('sends a reset link without saying whether the address has an account', async () => {
    server.use(http.post(`${AUTH}/recover`, () => gotrueOk({})));
    const { dialog } = await openDialog();
    type(field(dialog, 'Email'), 'ada@example.com');
    press(dialog, 'Forgot password?');
    expect(within(dialog).getByRole('heading', { name: 'Reset your password' })).toBeInTheDocument();
    expect(field(dialog, 'Email')).toHaveFocus();
    expect(within(dialog).queryByLabelText('Password')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Continue with Google' })).toBeNull();
    press(dialog, 'Send reset link');
    expect(await within(dialog).findByRole('heading', { name: 'Check your inbox' })).toBeInTheDocument();
    expect(paragraph(dialog, /has a devShark account/)).toHaveTextContent('If ada@example.com has a devShark account, we sent it a link to set a new password.');
    const recover = calls('/recover')[0];
    expect(recover.body).toMatchObject({ email: 'ada@example.com' });
    expect(recover.query.redirect_to).toBe('http://localhost:3000/reset-password');
    press(dialog, 'Back to sign in');
    expectMode(dialog, 'Sign in');
  });

  it('sends one sign-in, one account and one reset link for a press that lands twice', async () => {
    server.use(
      http.post(`${AUTH}/token`, () => authError(400, 'invalid_credentials', 'Invalid login credentials')),
      http.post(`${AUTH}/signup`, () => gotrueOk(emailUser({ confirmed: false }))),
      http.post(`${AUTH}/recover`, () => gotrueOk({})),
    );
    const { dialog } = await openDialog();
    type(field(dialog, 'Email'), 'ada@example.com');
    type(field(dialog, 'Password'), 'correct horse battery');
    // A double click, or Enter twice: both presses run before React draws the
    // first one's busy state.
    const twice = () => act(() => {
      const form = dialog.querySelector('form')!;
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    twice();
    await within(dialog).findByRole('alert');
    expect(calls('/token')).toHaveLength(1);

    signUpTab(dialog);
    type(field(dialog, 'Password'), 'correct horse battery');
    twice();
    await within(dialog).findByRole('heading', { name: 'Check your inbox' });
    expect(calls('/signup')).toHaveLength(1);

    press(dialog, 'Use a different email');
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Sign in' }));
    press(dialog, 'Forgot password?');
    twice();
    await within(dialog).findByRole('heading', { name: 'Check your inbox' });
    expect(calls('/recover')).toHaveLength(1);
  });

  it('keeps a late answer for a form the learner left off the form they moved to', async () => {
    let answer = () => {};
    server.use(http.post(`${AUTH}/token`, () => new Promise<Response>((resolve) => {
      answer = () => resolve(authError(400, 'invalid_credentials', 'Invalid login credentials'));
    })));
    const { dialog } = await openDialog();
    type(field(dialog, 'Email'), 'ada@example.com');
    type(field(dialog, 'Password'), 'wrong password');
    press(dialog, 'Sign in');
    await waitFor(() => expect(calls('/token')).toHaveLength(1));
    // The learner moves to Create account while the sign-in is still out.
    signUpTab(dialog);
    await act(async () => { answer(); });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Create account' })).toBeEnabled());
    expectMode(dialog, 'Create account');
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  it('closes on its close button and gives focus back to what opened it', async () => {
    const { dialog } = await openDialog();
    press(dialog, 'Close');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'Opener' })).toHaveFocus();
  });
});

describe('Continue with Google in the dialog', () => {
  it('leaves for Google with the page to come back to, and is pressable again after Back', async () => {
    const assign = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { dialog } = await openDialog({ returnTo: '/premium/cancel?action=withdraw' });
    // supabase-js leaves with location.assign, which jsdom cannot follow.
    const location = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...location, href: location.href, origin: location.origin, assign, replace: vi.fn() } });
    try {
      press(dialog, 'Continue with Google');
      await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: location });
    }
    const authorize = new URL(assign.mock.calls[0][0] as string);
    expect(authorize.pathname).toBe('/auth/v1/authorize');
    expect(authorize.searchParams.get('provider')).toBe('google');
    expect(JSON.parse(sessionStorage.getItem('devshark:auth-return') ?? '{}')).toMatchObject({ path: '/premium/cancel?action=withdraw' });
    const google = within(dialog).getByRole('button', { name: 'Opening Google…' });
    expect(google).toBeDisabled();
    // Back from Google's account chooser restores this page from the cache.
    act(() => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false })); });
    expect(within(dialog).getByRole('button', { name: 'Opening Google…' })).toBeDisabled();
    act(() => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
    expect(within(dialog).getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  });

  it('says so under the button when supabase-js cannot load', async () => {
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => {
        throw new TypeError('Failed to fetch dynamically imported module: https://devshark.app/assets/supabase-B5YuwSPF.js');
      },
    }));
    const { dialog } = await openDialog();
    press(dialog, 'Continue with Google');
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('We couldn’t reach the sign-in service. Check your connection and try again.');
    expect(within(dialog).getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
    // The banner sits under the Google button, above the email form.
    expect(alert.compareDocumentPosition(field(dialog, 'Email')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("the header's Log in", () => {
  it('takes the focus when it replaces the account button a Log out removed, and only then', async () => {
    const [{ LanguageProvider }, { default: SignInButton, focusSignInAfterSignOut }] = await Promise.all([
      import('../src/i18n/LanguageContext'),
      import('../src/components/SignInButton'),
    ]);
    const header = (signedIn: boolean) => (
      <LanguageProvider>{signedIn ? <button type="button">Account</button> : <SignInButton />}</LanguageProvider>
    );
    const view = render(header(true));
    screen.getByRole('button', { name: 'Account' }).focus();
    focusSignInAfterSignOut();
    view.rerender(header(false));
    expect(screen.getByRole('button', { name: 'Sign in' })).toHaveFocus();
    // Drawn again later, with no Log out pressed, it leaves the focus alone.
    view.rerender(header(true));
    screen.getByRole('button', { name: 'Account' }).focus();
    view.rerender(header(false));
    expect(screen.getByRole('button', { name: 'Sign in' })).not.toHaveFocus();
  });
});
