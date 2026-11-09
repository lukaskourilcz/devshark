// The sign-in dialog: "Continue with Google" first, then an email and
// password form that signs in, creates an account, or sends a password reset
// link. Opened by every "Sign in" in the app (lib/signInDialog.ts)
// and rendered by SignInDialogHost, which closes it when the account arrives.
//
// Creating an account signs nobody in: Supabase sends a confirmation link,
// and this dialog says where it went and offers to send it again once a
// minute has passed. The link lands on /auth/confirmed (AuthPages.tsx).
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Button } from '@astryxdesign/core/Button';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { useT } from '../../i18n/LanguageContext';
import type { TranslationKey } from '../../i18n/translations';
import { useAuth } from '../../lib/auth';
import { closeSignIn, type SignInRequest, type SignInView } from '../../lib/signInDialog';
import {
  PASSWORD_MIN_LENGTH,
  authFailure,
  emailProblem,
  markEmailSent,
  newPasswordProblem,
  passwordProblem,
  resendConfirmation,
  sendPasswordReset,
  signInWithEmail,
  signUpWithEmail,
  type AuthFailure,
} from '../../lib/emailAuth';
import { useClearOnPageRestore } from '../../lib/pageRestore';
import { GoogleIcon } from '../ui/icons';
import { EmailField, FailureBanner, PasswordField, ResendButton, useFieldMessage, withEmail } from './AuthFields';

type Stage = { kind: 'form' } | { kind: 'sent'; purpose: 'confirm' | 'reset'; email: string };
type Busy = null | 'google' | 'submit' | 'resend';

// One title for both modes (UX audit shell-public-05): 'Sign in to devShark'
// over a 'Sign in' tab over a 'Sign in' button said it three times. The
// segmented control carries the mode, and the submit says what it does.
const TITLES: Record<SignInView, TranslationKey> = {
  signIn: 'auth.dialog.accountTitle',
  signUp: 'auth.dialog.accountTitle',
  forgot: 'auth.dialog.forgotTitle',
};

export default function SignInDialog({ request }: { request: SignInRequest }) {
  const t = useT();
  const fieldMessage = useFieldMessage();
  const { signInWithGoogle } = useAuth();
  const [view, setView] = useState<SignInView>(request.view);
  const [stage, setStage] = useState<Stage>({ kind: 'form' });
  const [email, setEmail] = useState(request.email ?? '');
  const [password, setPassword] = useState('');
  const [blurred, setBlurred] = useState({ email: false, password: false });
  const [submitted, setSubmitted] = useState(false);
  const [failure, setFailure] = useState<{ kind: AuthFailure; from: 'google' | 'form' } | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  // The same, read at once: a second press in the same task (a double click,
  // Enter pressed twice) runs before React draws the first one's busy state,
  // and would send a second sign-in, account or email.
  const running = useRef<Busy>(null);
  const begin = (kind: Exclude<Busy, null>): boolean => {
    if (running.current) return false;
    running.current = kind;
    setBusy(kind);
    return true;
  };
  const finish = () => {
    running.current = null;
    setBusy(null);
  };
  const [sentVersion, setSentVersion] = useState(0);
  const [resent, setResent] = useState(false);
  const emailInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const sentLead = useRef<HTMLParagraphElement>(null);
  // Where focus goes after the next render, when the control that had it
  // is gone (a link that switched the view, or the form that was sent).
  const focusNext = useRef<'email' | 'sent' | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === 'email') emailInput.current?.focus();
    if (target === 'sent') sentLead.current?.focus();
  });
  // Back from Google's account chooser can bring this page back from the
  // cache with the Google button still busy.
  const clearGoogle = useCallback(() => {
    if (running.current === 'google') running.current = null;
    setBusy((now) => (now === 'google' ? null : now));
  }, []);
  useClearOnPageRestore(clearGoogle);

  const emailIssue = emailProblem(email);
  const passwordIssue = view === 'signUp' ? newPasswordProblem(password) : passwordProblem(password);
  // A field says what is wrong once the form was sent, or once the learner
  // left it with something typed: an empty field tabbed through is not an error.
  const showEmailIssue = submitted || (blurred.email && email.trim() !== '') ? emailIssue : null;
  const showPasswordIssue = submitted || (blurred.password && password !== '') ? passwordIssue : null;

  // Which form is on screen: a new one each time the learner moves to
  // another. An answer that arrives for a form the learner left is not that
  // form's to show; the email it may have sent still counts for the wait.
  const shown = useRef(0);
  const switchView = (next: SignInView, focusEmail = false) => {
    shown.current += 1;
    setView(next);
    setFailure(null);
    setSubmitted(false);
    setBlurred({ email: false, password: false });
    setResent(false);
    setStage({ kind: 'form' });
    if (focusEmail) focusNext.current = 'email';
  };

  const showSent = (purpose: 'confirm' | 'reset', address: string) => {
    markEmailSent(purpose, address);
    setSentVersion((now) => now + 1);
    setPassword('');
    setStage({ kind: 'sent', purpose, email: address.trim() });
    focusNext.current = 'sent';
  };

  const continueWithGoogle = async () => {
    if (!begin('google')) return;
    setFailure(null);
    try {
      // On success the page leaves for Google.
      await signInWithGoogle(request.returnTo);
    } catch (error) {
      if (!mounted.current) return;
      finish();
      setFailure({ kind: authFailure(error), from: 'google' });
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (running.current) return;
    setSubmitted(true);
    setFailure(null);
    if (emailIssue) {
      emailInput.current?.focus();
      return;
    }
    if (view !== 'forgot' && passwordIssue) {
      passwordInput.current?.focus();
      return;
    }
    begin('submit');
    const on = shown.current;
    if (view === 'forgot') {
      const outcome = await sendPasswordReset(email);
      if (!mounted.current) return;
      finish();
      if (on !== shown.current) {
        if (outcome.ok) markEmailSent('reset', email);
        return;
      }
      if (outcome.ok) showSent('reset', email);
      else setFailure({ kind: outcome.failure, from: 'form' });
      return;
    }
    if (view === 'signIn') {
      const outcome = await signInWithEmail(email, password, request.returnTo);
      if (!mounted.current) return;
      // Signed in: the host closes the dialog as the account arrives, so the
      // button stays busy until then.
      if (outcome.ok) return;
      finish();
      if (on === shown.current) setFailure({ kind: outcome.failure, from: 'form' });
      return;
    }
    const outcome = await signUpWithEmail(email, password, request.returnTo);
    if (!mounted.current) return;
    if (outcome.ok && outcome.signedIn) return;
    finish();
    if (on !== shown.current) {
      if (outcome.ok) markEmailSent('confirm', email);
      return;
    }
    if (outcome.ok) showSent('confirm', email);
    else setFailure({ kind: outcome.failure, from: 'form' });
  };

  const resend = async (purpose: 'confirm' | 'reset', address: string) => {
    if (!begin('resend')) return;
    setFailure(null);
    setResent(false);
    const on = shown.current;
    const outcome = purpose === 'confirm' ? await resendConfirmation(address, request.returnTo) : await sendPasswordReset(address);
    if (!mounted.current) return;
    finish();
    if (on !== shown.current) {
      if (outcome.ok || outcome.failure === 'emailRateLimited') markEmailSent(purpose, address);
      return;
    }
    if (!outcome.ok) {
      // Supabase refused for sending too often: wait the minute out here too.
      if (outcome.failure === 'emailRateLimited') {
        markEmailSent(purpose, address);
        setSentVersion((now) => now + 1);
      }
      setFailure({ kind: outcome.failure, from: 'form' });
      return;
    }
    if (stage.kind === 'sent') {
      markEmailSent(purpose, address);
      setSentVersion((now) => now + 1);
      setResent(true);
    } else {
      showSent(purpose, address);
    }
  };

  const title = stage.kind === 'sent' ? t('auth.dialog.sentTitle') : t(TITLES[view]);
  const subtitle = stage.kind === 'sent' ? undefined : view === 'forgot' ? t('auth.dialog.forgotSubtitle') : t('auth.dialog.subtitle');
  const formFailure = failure?.from === 'form' ? failure.kind : null;

  // The actions that fix what went wrong, under its banner.
  const failureActions = (kind: AuthFailure): ReactNode => {
    if (kind === 'emailNotConfirmed') {
      return <Button variant="secondary" label={t('auth.action.resendConfirmation')} isLoading={busy === 'resend'} isDisabled={busy !== null} onClick={() => void resend('confirm', email)} />;
    }
    if (kind === 'userExists') {
      return (
        <>
          <Button variant="secondary" label={t('auth.action.signInInstead')} onClick={() => switchView('signIn', true)} />
          <Button variant="ghost" label={t('auth.action.resetPassword')} onClick={() => switchView('forgot', true)} />
        </>
      );
    }
    return null;
  };

  const legal = t('auth.dialog.legal').split(/(\{terms\}|\{privacy\})/).map((part, index) => {
    if (part === '{terms}') return <Link key={index} to="/terms" onClick={closeSignIn}>{t('auth.dialog.terms')}</Link>;
    if (part === '{privacy}') return <Link key={index} to="/privacy" onClick={closeSignIn}>{t('auth.dialog.privacy')}</Link>;
    return part;
  });

  return (
    <Dialog
      isOpen
      onOpenChange={(open) => { if (!open) closeSignIn(); }}
      // A form: Escape and the close button leave it, a stray click on the
      // backdrop does not throw away what was typed.
      purpose="form"
      width="min(440px, calc(100vw - 32px))"
      maxHeight="calc(100dvh - 32px)"
      className="ss-sign-in-dialog"
    >
      <DialogHeader title={title} subtitle={subtitle} onOpenChange={(open) => { if (!open) closeSignIn(); }} />
      <div className="ss-auth ss-auth--dialog" aria-busy={busy === 'submit' || undefined}>
        {stage.kind === 'sent' ? (
          <>
            <p ref={sentLead} tabIndex={-1} className="ss-auth__lead">
              {withEmail(t(stage.purpose === 'confirm' ? 'auth.sent.confirmBody' : 'auth.sent.resetBody'), stage.email)}
            </p>
            <p className="ss-auth__note">{t('auth.sent.spamHint')}</p>
            {/* On the page before it has words: a live region that arrives
                with them is not read out. */}
            <p className="ss-auth__status" role="status">{resent ? t('auth.sent.resent') : ''}</p>
            {formFailure && <FailureBanner failure={formFailure} />}
            <div className="ss-auth__actions">
              <ResendButton
                purpose={stage.purpose}
                email={stage.email}
                version={sentVersion}
                busy={busy === 'resend'}
                onResend={() => void resend(stage.purpose, stage.email)}
              />
              <Button variant="primary" label={t('auth.sent.done')} onClick={closeSignIn} />
            </div>
            <p className="ss-auth__row ss-text-links">
              {stage.purpose === 'confirm' ? (
                <button type="button" onClick={() => switchView('signUp', true)}>{t('auth.sent.otherEmail')}</button>
              ) : (
                <button type="button" onClick={() => switchView('signIn', true)}>{t('auth.dialog.backToSignIn')}</button>
              )}
            </p>
          </>
        ) : (
          <>
            {view !== 'forgot' && (
              <>
                <div className="ss-auth__google">
                  <Button
                    variant="secondary"
                    size="md"
                    className="ss-action"
                    icon={<GoogleIcon />}
                    label={busy === 'google' ? t('auth.dialog.googleBusy') : t('auth.dialog.google')}
                    isLoading={busy === 'google'}
                    isDisabled={busy !== null}
                    onClick={() => void continueWithGoogle()}
                  />
                </div>
                {failure?.from === 'google' && <FailureBanner failure={failure.kind} />}
                <p className="ss-auth__or" aria-hidden="true">{t('auth.dialog.or')}</p>
                <SegmentedControl
                  value={view}
                  onChange={(value) => switchView(value as SignInView)}
                  label={t('auth.dialog.modeLabel')}
                  layout="fill"
                >
                  <SegmentedControlItem value="signIn" label={t('auth.dialog.signInTab')} />
                  <SegmentedControlItem value="signUp" label={t('auth.dialog.signUpTab')} />
                </SegmentedControl>
              </>
            )}
            <form className="ss-auth__form" method="post" noValidate onSubmit={(event) => void submit(event)}>
              <EmailField
                label={t('auth.email.label')}
                value={email}
                onChange={(value) => { setEmail(value); if (formFailure) setFailure(null); }}
                onBlur={() => setBlurred((now) => ({ ...now, email: true }))}
                error={fieldMessage(showEmailIssue)}
                inputRef={emailInput}
              />
              {/* The password and one reserved 44px row under it, in both
                  modes: 'Forgot password?' in Sign in, the length rule in
                  Create account. Both views are the same height, so the
                  centred dialog does not move under the pointer when the
                  mode changes (UX audit shell-public-05). */}
              {view !== 'forgot' && (
                <div className="ss-auth__password">
                  <PasswordField
                    label={t('auth.password.label')}
                    value={password}
                    onChange={(value) => { setPassword(value); if (formFailure) setFailure(null); }}
                    onBlur={() => setBlurred((now) => ({ ...now, password: true }))}
                    error={fieldMessage(showPasswordIssue)}
                    hint={view === 'signUp' ? t('auth.password.rule', { min: PASSWORD_MIN_LENGTH }) : undefined}
                    autoComplete={view === 'signUp' ? 'new-password' : 'current-password'}
                    inputRef={passwordInput}
                  />
                  {view === 'signIn' && (
                    <p className="ss-auth__forgot">
                      <button type="button" onClick={() => switchView('forgot', true)}>{t('auth.dialog.forgotLink')}</button>
                    </p>
                  )}
                </div>
              )}
              {formFailure && <FailureBanner failure={formFailure}>{failureActions(formFailure)}</FailureBanner>}
              <div className="ss-auth__submit">
                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  className="ss-action"
                  label={submitLabel(view, busy === 'submit', t)}
                  isLoading={busy === 'submit'}
                  isDisabled={busy !== null && busy !== 'submit'}
                />
              </div>
            </form>
            {view === 'forgot' ? (
              <p className="ss-auth__row ss-text-links">
                <button type="button" onClick={() => switchView('signIn', true)}>{t('auth.dialog.backToSignIn')}</button>
              </p>
            ) : (
              <p className="ss-auth__legal">{legal}</p>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

function submitLabel(view: SignInView, busy: boolean, t: (key: TranslationKey) => string): string {
  if (view === 'forgot') return t(busy ? 'auth.dialog.sending' : 'auth.dialog.sendReset');
  if (view === 'signUp') return t(busy ? 'auth.dialog.signingUp' : 'auth.dialog.signUpSubmit');
  return t(busy ? 'auth.dialog.signingIn' : 'auth.dialog.signInSubmit');
}
