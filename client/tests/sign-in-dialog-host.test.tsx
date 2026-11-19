// The sign-in dialog's host in the app shell (SignInDialogHost.tsx): the
// dialog's code loads on the first press, a failed load closes it with a
// toast, a second failed press reloads and the next document opens the
// dialog, and the account arriving closes it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import type { BuildCheck, Recovery } from '../src/lib/routeRecovery';
import { closeSignIn, openSignIn, takeSignInDialogResume } from '../src/lib/signInDialog';
import SignInDialogHost from '../src/components/auth/SignInDialogHost';
import SignInButton from '../src/components/SignInButton';
import type { SignInRequest } from '../src/lib/signInDialog';

vi.mock('../src/lib/sentry', () => ({ reportError: vi.fn(), initSentry: vi.fn() }));
const auth = vi.hoisted(() => ({ value: { isAuthenticated: false } }));
vi.mock('../src/lib/auth', () => ({ useAuth: () => auth.value }));
// The dialog's code "does not load" while `fails`: rendering it throws what
// the lazy part throws when its import fails.
const dialog = vi.hoisted(() => ({ fails: true }));
vi.mock('../src/components/auth/SignInDialog', () => ({
  default: ({ request }: { request: SignInRequest }) => {
    if (dialog.fails) throw new TypeError('Failed to fetch dynamically imported module: http://localhost:3000/assets/SignInDialog-AAAA.js');
    return <div role="dialog" aria-label="Sign in">{`${request.view} ${request.returnTo ?? ''}`}</div>;
  },
}));

let online = true;
beforeEach(() => {
  online = true;
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  delete (window.navigator as { onLine?: boolean }).onLine;
  window.sessionStorage.clear();
  auth.value = { isAuthenticated: false };
  act(() => closeSignIn());
});

function fakeRecovery(check: BuildCheck = 'same') {
  return { checkServedBuild: vi.fn(async () => check), reload: vi.fn() } satisfies Recovery;
}

async function mountHost(recovery: Recovery = fakeRecovery()) {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <MemoryRouter>
        <LanguageProvider>
          <main id="main-content" tabIndex={-1}>the page</main>
          <SignInButton />
          <SignInDialogHost recovery={recovery} />
        </LanguageProvider>
      </MemoryRouter>,
    );
  });
  return view;
}

describe('the sign-in dialog host', () => {
  it('restores an explicit opener when a pointer leaves focus on the page', async () => {
    dialog.fails = false;
    await mountHost();
    const page = screen.getByText('the page');
    const trigger = screen.getByRole('button', { name: 'Sign in' });
    page.focus();
    await act(async () => openSignIn({}, trigger));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    act(() => closeSignIn());
    expect(trigger).toHaveFocus();
  });

  it('remembers the header trigger even when clicking does not focus it', async () => {
    dialog.fails = false;
    await mountHost();
    const page = screen.getByText('the page');
    const trigger = screen.getByRole('button', { name: 'Sign in' });
    page.focus();
    fireEvent.click(trigger);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    act(() => closeSignIn());
    expect(trigger).toHaveFocus();
  });

  it('keeps active-element restoration for a programmatic open', async () => {
    dialog.fails = false;
    await mountHost();
    const trigger = screen.getByRole('button', { name: 'Sign in' });
    trigger.focus();
    await act(async () => openSignIn());
    const shown = await screen.findByRole('dialog');
    shown.tabIndex = -1;
    shown.focus();
    act(() => closeSignIn());
    expect(trigger).toHaveFocus();
  });

  it('closes when the dialog’s code does not load and says so, and opens on the next press', async () => {
    dialog.fails = true;
    await mountHost();
    await act(async () => openSignIn());
    expect(await screen.findByRole('alert')).toHaveTextContent('Network error. Check your connection and try again.');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('the page')).toBeInTheDocument();

    dialog.fails = false;
    await act(async () => openSignIn({ view: 'signUp' }));
    expect(await screen.findByRole('dialog', { name: 'Sign in' })).toHaveTextContent('signUp');
  });

  it('reloads on a press that meets the failure again, and the next document opens the dialog that was asked for', async () => {
    dialog.fails = true;
    const recovery = fakeRecovery();
    const view = await mountHost(recovery);
    await act(async () => openSignIn({ returnTo: '/premium#voucher' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Network error.');
    expect(recovery.reload).not.toHaveBeenCalled();

    await act(async () => openSignIn({ returnTo: '/premium#voucher' }));
    await vi.waitFor(() => expect(recovery.reload).toHaveBeenCalledTimes(1));
    expect(JSON.parse(window.sessionStorage.getItem('devshark:signin-dialog-resume') ?? '{}')).toMatchObject({ view: 'signIn', returnTo: '/premium#voucher' });

    view.unmount();
    act(() => closeSignIn());
    dialog.fails = false;
    await mountHost();
    expect(await screen.findByRole('dialog', { name: 'Sign in' })).toHaveTextContent('signIn /premium#voucher');
    expect(window.sessionStorage.getItem('devshark:signin-dialog-resume')).toBeNull();
  });

  it('does not reload while the server does not answer, and says why', async () => {
    dialog.fails = true;
    const recovery = fakeRecovery('unreachable');
    await mountHost(recovery);
    await act(async () => openSignIn());
    await screen.findByRole('alert');
    await act(async () => openSignIn());
    await vi.waitFor(() => expect(recovery.checkServedBuild).toHaveBeenCalledTimes(1));
    expect(recovery.reload).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem('devshark:signin-dialog-resume')).toBeNull();
  });

  it('closes when the account arrives, and says so to a screen reader', async () => {
    dialog.fails = false;
    const view = await mountHost();
    await act(async () => openSignIn());
    expect(await screen.findByRole('dialog', { name: 'Sign in' })).toBeInTheDocument();
    auth.value = { isAuthenticated: true };
    view.rerender(
      <MemoryRouter>
        <LanguageProvider>
          <main>the page</main>
          <SignInDialogHost recovery={fakeRecovery()} />
        </LanguageProvider>
      </MemoryRouter>,
    );
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('status')).toHaveTextContent('You’re signed in.');
  });

  it('ignores a stale or foreign mark', async () => {
    dialog.fails = false;
    window.sessionStorage.setItem('devshark:signin-dialog-resume', JSON.stringify({ view: 'signUp', at: Date.now() - 61_000 }));
    await mountHost();
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(screen.queryByRole('dialog')).toBeNull();
    window.sessionStorage.setItem('devshark:signin-dialog-resume', JSON.stringify({ view: 'admin', returnTo: '//evil.example/x', at: Date.now() }));
    expect(takeSignInDialogResume()).toEqual({ view: undefined, returnTo: undefined });
  });
});
