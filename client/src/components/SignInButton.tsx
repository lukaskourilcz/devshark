// The header's control for a signed-out visitor: "Sign in", which opens the
// sign-in dialog (Google, or an email and password; lib/signInDialog.ts).
//
// It ships with the app shell instead of inside the lazy account widget
// (AuthButton). A visitor with no stored session is signed out from the first
// render (lib/auth.tsx), so the header can draw this button in its first frame
// at its final size. Drawn as the lazy widget's 56px placeholder, the header
// stood 16px taller until the chunk arrived, and <main> moved up when it did.
// The dialog's code loads on the press; a dialog that fails says so in a toast
// (SignInDialogHost).
import { useEffect, useRef } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { useT } from '../i18n/LanguageContext';
import { openSignIn } from '../lib/signInDialog';

// The header's Log out is pressed from the account menu, and the account
// button goes when the session does: focus fell to <body>. This button takes
// that place in the header, so it takes the focus too, when it is drawn within
// a few seconds of a Log out and nothing else holds the focus.
const FOCUS_WINDOW_MS = 5_000;
let focusAfterSignOutUntil = 0;
/** A Log out was pressed in the header: the Sign in that replaces the account
 * button takes the focus. `false` withdraws it (the Log out failed). */
export function focusSignInAfterSignOut(on = true): void {
  focusAfterSignOutUntil = on ? Date.now() + FOCUS_WINDOW_MS : 0;
}

export default function SignInButton() {
  const t = useT();
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (Date.now() > focusAfterSignOutUntil) return;
    focusAfterSignOutUntil = 0;
    const active = document.activeElement;
    if (!active || active === document.body) ref.current?.focus();
  }, []);
  // A page action like any other (UX audit shell-public-02): 44px, 16px/600.
  return <Button ref={ref} variant="secondary" size="md" className="ss-action" label={t('auth.logIn')} aria-haspopup="dialog" onClick={(event) => openSignIn({}, event.currentTarget)} />;
}
