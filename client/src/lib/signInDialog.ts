// The one sign-in dialog, as a tiny store, like the upgrade sheet
// (lib/upgradeSheet.ts). Every "Log in" and "Sign in" in the app opens it:
// Google first, then an email and password. `SignInDialogHost` in App renders
// it, and its code loads the first time something asks.
import { useSyncExternalStore } from 'react';
import { isSafeReturnPath } from './authReturn';

/** Which form the dialog opens on. */
export type SignInView = 'signIn' | 'signUp' | 'forgot';

export interface SignInRequest {
  view: SignInView;
  /** A path on this site to land on after signing in (lib/authReturn.ts);
   * without it the learner stays on, or comes back to, the page they are on. */
  returnTo?: string;
  /** An address to start the form with. */
  email?: string;
  /** Increments per request, so asking twice re-announces the dialog. */
  id: number;
}

type SignInDetail = { view?: SignInView; returnTo?: string; email?: string };

let current: SignInRequest | null = null;
let counter = 0;
// The trigger, or what had focus for a programmatic open. A pointer need
// not focus its button in Safari. The dialog unmounts on close, so the host
// gives focus back to the saved element instead of leaving it on <body>.
let opener: HTMLElement | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function openSignIn(detail: SignInDetail = {}, trigger?: HTMLElement): void {
  if (!current && typeof document !== 'undefined') {
    const active = document.activeElement;
    opener = trigger ?? (active instanceof HTMLElement && active !== document.body ? active : null);
  }
  counter += 1;
  current = { view: detail.view ?? 'signIn', returnTo: detail.returnTo, email: detail.email, id: counter };
  emit();
}

/** The opening trigger or previous focus target, handed out once. */
export function takeSignInOpener(): HTMLElement | null {
  const element = opener;
  opener = null;
  return element;
}

export function closeSignIn(): void {
  if (!current) return;
  current = null;
  emit();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useSignInRequest(): SignInRequest | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}

// ── A dialog that opens after a reload ─────────────────────────────────────
//
// When the dialog's code fails a second time in one document, the press
// reloads the page (SignInDialogHost), as the upgrade sheet does, and this
// mark lets the next document open the dialog that was asked for.

const RESUME_KEY = 'devshark:signin-dialog-resume';
const VIEWS: readonly SignInView[] = ['signIn', 'signUp', 'forgot'];
/** Long enough for a slow reload, short enough that a tab reopened later
 * never opens the dialog by itself. */
export const SIGN_IN_RESUME_MAX_AGE_MS = 60_000;

export function markSignInDialogResume(detail: { view?: SignInView; returnTo?: string }, now = Date.now()): void {
  try {
    sessionStorage.setItem(RESUME_KEY, JSON.stringify({ view: detail.view, returnTo: detail.returnTo, at: now }));
  } catch {
    // Without storage the next document cannot open it; the learner presses again.
  }
}

export function clearSignInDialogResume(): void {
  try {
    sessionStorage.removeItem(RESUME_KEY);
  } catch {
    // ignore
  }
}

/** The request the document before this one could not open, removed as it is
 * read; null when there is none or it is stale. */
export function takeSignInDialogResume(now = Date.now()): { view?: SignInView; returnTo?: string } | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(RESUME_KEY);
    sessionStorage.removeItem(RESUME_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { view?: unknown; returnTo?: unknown; at?: unknown };
    if (typeof value.at !== 'number' || now < value.at || now - value.at > SIGN_IN_RESUME_MAX_AGE_MS) return null;
    return {
      view: VIEWS.includes(value.view as SignInView) ? value.view as SignInView : undefined,
      returnTo: isSafeReturnPath(value.returnTo) ? value.returnTo : undefined,
    };
  } catch {
    return null;
  }
}
