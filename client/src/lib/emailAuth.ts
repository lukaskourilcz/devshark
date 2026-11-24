// Email and password sign-in on Supabase Auth, beside Google (lib/auth.tsx).
//
// Every call loads supabase-js on demand (lib/supabaseClient.ts) and answers
// with an outcome instead of throwing, so a screen can say exactly what went
// wrong: a wrong password, an address nobody confirmed, an account that
// exists already, a password the service refused, too many attempts, or no
// connection at all.
//
// The flows, with the production project confirming every new address:
//
//   * create an account: signUp sends a confirmation link to
//     /auth/confirmed?next=<the page that asked>; nobody is signed in until
//     the link is opened, on this device or another;
//   * sign in: signInWithPassword, in the page; the return path, when a page
//     named one, is taken by the app shell like a Google return;
//   * forgot the password: resetPasswordForEmail sends a link to
//     /reset-password, which opens a recovery session (PASSWORD_RECOVERY) and
//     sets a new password with updateUser.
//
// Both landing pages also accept the scanner-safe link Supabase's templates
// can send instead (`?token_hash=…&type=…`): the learner presses a button and
// verifyOtp opens the session, so a mail filter that fetches every link
// cannot use it up first (NEEDED.md has the templates).
import { useEffect, useState } from 'react';
import type { EmailOtpType, SupabaseClient } from '@supabase/supabase-js';
import { loadSupabase } from './supabaseClient';
import {
  isAuthLandingPath,
  CONFIRMED_PATH,
  RESET_PASSWORD_PATH,
  clearAuthReturn,
  currentReturnPath,
  isSafeReturnPath,
  rememberAuthReturn,
} from './authReturn';
import { isChunkLoadError } from './routeRecovery';

/** The shortest password a new account or a reset may set. Supabase accepts
 * six by default; NEEDED.md asks for its minimum to be set to this too, so
 * the two never disagree. Signing in never checks it: an existing password is
 * whatever the service accepted when it was set. */
export const PASSWORD_MIN_LENGTH = 8;
/** Supabase Auth stores passwords with bcrypt, which reads 72 bytes and
 * refuses anything longer. */
export const PASSWORD_MAX_BYTES = 72;
/** Supabase Auth sends one confirmation or reset email per address a minute;
 * the resend buttons wait as long. */
export const RESEND_COOLDOWN_MS = 60_000;

// ── Field checks ────────────────────────────────────────────────────────────

export type EmailProblem = 'emailRequired' | 'emailInvalid';
export type PasswordProblem = 'passwordRequired' | 'passwordShort' | 'passwordLong';

/** One @, something before it, a dot in the domain, no spaces. Supabase
 * decides the rest. */
export function emailProblem(value: string): EmailProblem | null {
  const email = value.trim();
  if (!email) return 'emailRequired';
  return /^[^\s@]+@[^\s@]+\.[^\s@.]+$/.test(email) ? null : 'emailInvalid';
}

/** For signing in: any non-empty password. */
export function passwordProblem(value: string): PasswordProblem | null {
  return value ? null : 'passwordRequired';
}

/** For a new password: 8 characters at least, 72 bytes at most. */
export function newPasswordProblem(value: string): PasswordProblem | null {
  if (!value) return 'passwordRequired';
  if ([...value].length < PASSWORD_MIN_LENGTH) return 'passwordShort';
  if (new TextEncoder().encode(value).length > PASSWORD_MAX_BYTES) return 'passwordLong';
  return null;
}

// ── What went wrong ─────────────────────────────────────────────────────────

export type AuthFailure =
  | 'invalidCredentials'
  | 'emailNotConfirmed'
  | 'userExists'
  | 'weakPassword'
  | 'pwnedPassword'
  | 'samePassword'
  | 'reauthenticate'
  | 'rateLimited'
  | 'emailRateLimited'
  | 'emailDisabled'
  | 'emailInvalid'
  | 'linkExpired'
  | 'sessionMissing'
  | 'network'
  | 'serviceError'
  | 'unavailable'
  | 'unknown';

interface AuthErrorLike {
  name?: unknown;
  status?: unknown;
  code?: unknown;
  message?: unknown;
  reasons?: unknown;
}

const CODES: Record<string, AuthFailure> = {
  invalid_credentials: 'invalidCredentials',
  email_not_confirmed: 'emailNotConfirmed',
  user_already_exists: 'userExists',
  email_exists: 'userExists',
  identity_already_exists: 'userExists',
  weak_password: 'weakPassword',
  same_password: 'samePassword',
  reauthentication_needed: 'reauthenticate',
  reauthentication_not_valid: 'reauthenticate',
  over_request_rate_limit: 'rateLimited',
  over_email_send_rate_limit: 'emailRateLimited',
  signup_disabled: 'emailDisabled',
  email_provider_disabled: 'emailDisabled',
  provider_disabled: 'emailDisabled',
  email_address_invalid: 'emailInvalid',
  email_address_not_authorized: 'emailInvalid',
  otp_expired: 'linkExpired',
  flow_state_expired: 'linkExpired',
  flow_state_not_found: 'linkExpired',
  session_not_found: 'sessionMissing',
  session_expired: 'sessionMissing',
  refresh_token_not_found: 'sessionMissing',
  refresh_token_already_used: 'sessionMissing',
  bad_jwt: 'sessionMissing',
};

/**
 * What a supabase-js auth error means for the learner. Read by name, code and
 * status rather than by class, since importing supabase-js here would put it
 * back in the first page load. Older Auth servers sent some errors without a
 * code, so the two that matter most are also read from their message.
 */
export function authFailure(error: unknown): AuthFailure {
  if (!error || typeof error !== 'object') return 'unknown';
  const { name, status, code, message, reasons } = error as AuthErrorLike;
  // No answer at all: offline, or the request never left. supabase-js names
  // a 5xx retryable too, but that one was answered: the service had a problem
  // (a confirmation email it could not send answers 500).
  if (status === 0 || (name === 'AuthRetryableFetchError' && typeof status !== 'number')) return 'network';
  if (name === 'AuthRetryableFetchError') return 'serviceError';
  // The supabase-js download itself failed (lib/supabaseClient.ts).
  if (isChunkLoadError(error)) return 'network';
  if (name === 'AuthWeakPasswordError' || code === 'weak_password') {
    return Array.isArray(reasons) && reasons.includes('pwned') ? 'pwnedPassword' : 'weakPassword';
  }
  if (name === 'AuthSessionMissingError') return 'sessionMissing';
  if (typeof code === 'string' && CODES[code]) return CODES[code];
  const text = typeof message === 'string' ? message.toLowerCase() : '';
  // "Unable to validate email address: invalid format"
  if (code === 'validation_failed' && text.includes('email')) return 'emailInvalid';
  if (text.includes('invalid login credentials')) return 'invalidCredentials';
  if (text.includes('email not confirmed')) return 'emailNotConfirmed';
  if (status === 429) return 'rateLimited';
  if (typeof status === 'number' && status >= 500) return 'serviceError';
  return 'unknown';
}

/** The error a URL carries back from an email link that did not work
 * (`#error=access_denied&error_code=otp_expired&…`), as supabase-js leaves it
 * in the address bar. Null when there is none. */
export function linkErrorIn(location: Pick<Location, 'hash' | 'search'>): AuthFailure | null {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  new URLSearchParams(location.search).forEach((value, key) => {
    if (!params.has(key)) params.set(key, value);
  });
  if (!params.get('error') && !params.get('error_code') && !params.get('error_description')) return null;
  const failure = authFailure({ code: params.get('error_code') ?? undefined, message: params.get('error_description') ?? undefined });
  // Expired, used, or refused: every one of them needs a new link.
  return failure === 'unknown' ? 'linkExpired' : failure;
}

// ── The calls ───────────────────────────────────────────────────────────────

export type AuthOutcome = { ok: true } | { ok: false; failure: AuthFailure };
const failed = (error: unknown): AuthOutcome => ({ ok: false, failure: authFailure(error) });

class Unavailable extends Error {}

async function supabase(): Promise<SupabaseClient> {
  const client = await loadSupabase();
  if (!client) throw new Unavailable('Sign-in is not available in this deployment.');
  return client;
}

/** Runs one call, turning a failed download or a build without Supabase into
 * an outcome as well. */
async function attempt(run: (client: SupabaseClient) => Promise<AuthOutcome>): Promise<AuthOutcome> {
  try {
    return await run(await supabase());
  } catch (error) {
    if (error instanceof Unavailable) return { ok: false, failure: 'unavailable' };
    return failed(error);
  }
}

const normalise = (email: string) => email.trim();

/** Where a confirmation link sends the learner: /auth/confirmed, with the
 * page that asked as `next` so the page can offer the way back. */
export function confirmationRedirect(returnTo?: string | null, origin = window.location.origin): string {
  const asked = returnTo ?? currentReturnPath();
  const next = asked && isSafeReturnPath(asked) && !isAuthLandingPath(asked) ? asked : null;
  return `${origin}${CONFIRMED_PATH}${next ? `?next=${encodeURIComponent(next)}` : ''}`;
}

/**
 * Signs in with an address and password. `returnTo` is a page to go to once
 * the account arrives, like a Google sign-in's; without one the learner stays
 * where they are. The account arrives through supabase-js's SIGNED_IN, which
 * lib/auth.tsx hears like any other sign-in.
 */
export function signInWithEmail(email: string, password: string, returnTo?: string | null): Promise<AuthOutcome> {
  // A sign-in from here must not inherit an older page's return.
  clearAuthReturn();
  if (returnTo) rememberAuthReturn(returnTo);
  return attempt(async (client) => {
    const { error } = await client.auth.signInWithPassword({ email: normalise(email), password });
    return error ? failed(error) : { ok: true };
  }).then((outcome) => {
    if (!outcome.ok) clearAuthReturn();
    return outcome;
  });
}

export type SignUpOutcome = { ok: true; signedIn: boolean } | { ok: false; failure: AuthFailure };

/**
 * Creates an account and sends the confirmation link. With confirmation on,
 * as in production, nobody is signed in yet (`signedIn: false`). Supabase
 * answers an address that already has a confirmed account with a user that
 * has no identities and sends nothing; that is "already exists" here.
 */
export async function signUpWithEmail(email: string, password: string, returnTo?: string | null): Promise<SignUpOutcome> {
  let signedIn = false;
  const outcome = await attempt(async (client) => {
    const { data, error } = await client.auth.signUp({
      email: normalise(email),
      password,
      options: { emailRedirectTo: confirmationRedirect(returnTo) },
    });
    if (error) return failed(error);
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return { ok: false, failure: 'userExists' };
    }
    signedIn = Boolean(data.session);
    return { ok: true };
  });
  return outcome.ok ? { ok: true, signedIn } : outcome;
}

/** Sends the confirmation link again. */
export function resendConfirmation(email: string, returnTo?: string | null): Promise<AuthOutcome> {
  return attempt(async (client) => {
    const { error } = await client.auth.resend({
      type: 'signup',
      email: normalise(email),
      options: { emailRedirectTo: confirmationRedirect(returnTo) },
    });
    return error ? failed(error) : { ok: true };
  });
}

/** Sends a link to /reset-password. Supabase answers the same whether or not
 * an account uses the address, so the screen must not say which. */
export function sendPasswordReset(email: string): Promise<AuthOutcome> {
  return attempt(async (client) => {
    const { error } = await client.auth.resetPasswordForEmail(normalise(email), {
      redirectTo: `${window.location.origin}${RESET_PASSWORD_PATH}`,
    });
    return error ? failed(error) : { ok: true };
  });
}

export type PasswordOutcome = { ok: true; otherDevicesSignedOut: boolean } | { ok: false; failure: AuthFailure };

/**
 * Sets a new password for the signed-in account, then ends the account's
 * sessions on other devices: whoever else knew the old password is out.
 * This browser stays signed in.
 */
export async function updatePassword(password: string): Promise<PasswordOutcome> {
  let otherDevicesSignedOut = false;
  const outcome = await attempt(async (client) => {
    const { error } = await client.auth.updateUser({ password });
    if (error) return failed(error);
    const others = await client.auth.signOut({ scope: 'others' }).catch((thrown: unknown) => ({ error: thrown }));
    otherDevicesSignedOut = !others.error;
    return { ok: true };
  });
  return outcome.ok ? { ok: true, otherDevicesSignedOut } : outcome;
}

/** The link types each landing page accepts as `?token_hash=…&type=…`. */
const LINK_TYPES: Record<'confirm' | 'recovery', readonly EmailOtpType[]> = {
  confirm: ['email', 'signup'],
  recovery: ['recovery'],
};

/** A scanner-safe link's token and type, when this page accepts them. */
export function tokenLinkIn(search: string, purpose: 'confirm' | 'recovery'): { tokenHash: string; type: EmailOtpType } | null {
  const params = new URLSearchParams(search);
  const tokenHash = params.get('token_hash');
  const type = params.get('type') as EmailOtpType | null;
  if (!tokenHash || !/^[\w-]{8,256}$/.test(tokenHash) || !type || !LINK_TYPES[purpose].includes(type)) return null;
  return { tokenHash, type };
}

/** Opens the session a scanner-safe link carries. supabase-js then announces
 * SIGNED_IN, or PASSWORD_RECOVERY for a reset link. */
export function verifyEmailLink(link: { tokenHash: string; type: EmailOtpType }): Promise<AuthOutcome> {
  return attempt(async (client) => {
    const { error } = await client.auth.verifyOtp({ token_hash: link.tokenHash, type: link.type });
    return error ? failed(error) : { ok: true };
  });
}

// ── Resend cooldown ─────────────────────────────────────────────────────────
//
// Kept for this tab, per purpose and address, so closing and reopening the
// dialog does not reset it. Supabase enforces its own limit as well; this
// only keeps the button from asking for what it would refuse.

type EmailPurpose = 'confirm' | 'reset';
const sentAt = new Map<string, number>();
const cooldownKey = (purpose: EmailPurpose, email: string) => `${purpose}:${normalise(email).toLowerCase()}`;

export function markEmailSent(purpose: EmailPurpose, email: string, now = Date.now()): void {
  sentAt.set(cooldownKey(purpose, email), now);
}

/** Whole seconds until another email of this kind may go to this address. */
export function cooldownSeconds(purpose: EmailPurpose, email: string, now = Date.now()): number {
  const at = sentAt.get(cooldownKey(purpose, email));
  if (at === undefined) return 0;
  return Math.max(0, Math.ceil((at + RESEND_COOLDOWN_MS - now) / 1000));
}

/** The seconds left, counting down once a second while there are any. Read
 * on every render, so the render that follows a send already counts. */
export function useCooldown(purpose: EmailPurpose, email: string, version = 0): number {
  const [, setTick] = useState(0);
  const left = cooldownSeconds(purpose, email);
  useEffect(() => {
    if (cooldownSeconds(purpose, email) === 0) return;
    const timer = window.setInterval(() => {
      setTick((tick) => tick + 1);
      if (cooldownSeconds(purpose, email) === 0) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [purpose, email, version]);
  return left;
}
