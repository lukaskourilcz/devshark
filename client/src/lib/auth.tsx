import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AuthChangeEvent, Session, SupabaseClient, User } from '@supabase/supabase-js';
import {
  forgetStoredSession,
  getSupabaseSession,
  hasStoredSession,
  loadSupabase,
  mayHaveSession,
  onSupabaseAuthStateChange,
  onSupabaseSessionRemoved,
  openedOnAuthRedirect,
  storedSessionUserId,
  supabaseForSession,
  supabaseLoadFailed,
} from './supabaseClient';
import { ApiError, apiFetch } from './api';
import { beforeAccountChange, clearAccountData, forgetOthersKeptDrafts } from './accountData';
import { queryClient } from './queryClient';
import { readString, removeStored, writeString } from './storage';
import { clearAuthReturn, clearSignInResume, currentReturnPath, markSignInResume, rememberAuthReturn, takeSignInResume } from './authReturn';
import { RELOAD_GRACE_MS, browserRecovery, isChunkLoadError, reloadOnPress, type Recovery } from './routeRecovery';

// Report a real sign-in to the server (powers the /dev "Logs" tab) at most once
// per browser tab session, so page refreshes (which re-emit SIGNED_IN) don't log
// repeatedly. The server verifies the token and classifies register vs login.
const AUTH_REPORTED_KEY = 'devquiz:auth-reported';
const AUTH_BOOT_TIMEOUT_MS = 8_000;

function withDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Authentication timed out')), timeoutMs);
    promise.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (error) => { window.clearTimeout(timer); reject(error); },
    );
  });
}
// The report on its way, and which sign-in it was for: a sign-out in between
// (clearSignInReport) moves the generation on, so a late answer for the
// account that left cannot mark the next one's sign-in as reported.
let reportInFlight = false;
let reportGeneration = 0;
function reportSignIn(): void {
  try {
    if (sessionStorage.getItem(AUTH_REPORTED_KEY)) return;
  } catch {
    // sessionStorage unavailable — fall through and still report
  }
  if (reportInFlight) return;
  reportInFlight = true;
  const generation = reportGeneration;
  // Fire-and-forget: never let logging affect the sign-in UX. The tab counts
  // as reported once the server decided on the report; one that never got an
  // answer (offline, a 5xx during an outage, a 429) is sent again on the next
  // sign-in supabase-js announces in this tab.
  const settled = (decided: boolean) => {
    if (generation !== reportGeneration) return;
    reportInFlight = false;
    if (!decided) return;
    try {
      sessionStorage.setItem(AUTH_REPORTED_KEY, '1');
    } catch {
      // ignore
    }
  };
  void apiFetch('/api/user/authevent', { method: 'POST', body: '{}' }).then(
    () => settled(true),
    (error: unknown) => {
      const status = error instanceof ApiError ? error.status : 0;
      settled(status >= 400 && status < 500 && status !== 429);
    },
  );
}
/** Which sign-in a session belongs to: the Auth session id in its access token
 * (`session_id`, the same through every token refresh, new on every sign-in),
 * or, for a token without one, the account and its last sign-in time. */
export function signInIdOf(session: { access_token?: string; user?: { id?: string; last_sign_in_at?: string } | null } | null): string | null {
  const user = session?.user;
  if (!user?.id) return null;
  try {
    const sid = (JSON.parse(atob(session!.access_token!.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { session_id?: unknown }).session_id;
    if (typeof sid === 'string' && sid) return sid;
  } catch {
    // Not a JWT this module can read: the account and its last sign-in say it.
  }
  return `${user.id} ${user.last_sign_in_at}`;
}
/** supabase-js's AuthRetryableFetchError (no answer, or a 502/503/504) or any
 * other 5xx: the server did not decide anything. Read by name and status, as
 * importing supabase-js here would put it back in the first page load. */
function serverUnreachable(error: { name?: string; status?: number }): boolean {
  return error.name === 'AuthRetryableFetchError' || (typeof error.status === 'number' && (error.status === 0 || error.status >= 500));
}
function clearSignInReport(): void {
  reportGeneration += 1;
  reportInFlight = false;
  try {
    sessionStorage.removeItem(AUTH_REPORTED_KEY);
  } catch {
    // ignore
  }
}

// Every account change (a sign-out, another account's session replacing this
// one, a Log out without the server, a deleted account) forgets the account's
// data through clearAccountData, in the auth handler before the user state
// changes. The cached responses go with it, so the next account's first
// render cannot draw the previous learner's wallet, due concepts or saved
// flashcards from shared keys that carry no account id.
beforeAccountChange(() => queryClient.clear());

// Read once, as the modules evaluate: whether the document before this one
// reloaded on a sign-in press and left the sign-in for this one to finish.
let resumePending = typeof window !== 'undefined' && takeSignInResume();

// Whether an account was signed in on this page: a session was stored when it
// opened (supabase-js may still find it expired), or one arrived since. Only
// then does a SIGNED_OUT forget the account's data on this device; supabase-js
// also sends one for a guest's failed OAuth return, and a guest keeps theirs.
let accountSignedIn = typeof window !== 'undefined' && hasStoredSession();
// Which account that is: supabase-js removes a session it cannot refresh
// before it says SIGNED_OUT, so the id is read while there is one.
let accountId = typeof window !== 'undefined' ? storedSessionUserId() : null;
/** The account signed in on this page, or null. */
export const signedInAccount = (): string | null => (accountSignedIn ? accountId : null);

// A Log out the learner pressed, here or in another tab of this browser
// (supabase-js tells the others with its own SIGNED_OUT). Any other SIGNED_OUT
// of an account (a refresh refused: the session expired or was revoked, or
// the password changed elsewhere) keeps its coding drafts for it.
const CHOSEN = 'devshark:signed-out-by-choice';
const chooseSignOut = () => writeString(CHOSEN, String(Date.now()));
const signOutChosen = () => Date.now() - Number(readString(CHOSEN)) < 30_000;

/** How far a sign-out reaches. `local` ends this browser's session only (the
 * header's Log out); `global` also ends every other session of the account,
 * on every device (Profile → Account). */
export type SignOutScope = 'local' | 'global';

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** Sign in with Google. `returnTo` is a path on this site to come back to
   * after the round trip (see lib/authReturn.ts); without it the visitor comes
   * back to the page the sign-in was pressed on. Pages do not call this: they
   * open the sign-in dialog (lib/signInDialog.ts), whose Google button does.
   * Email and password sign-in lives in lib/emailAuth.ts. */
  signInWithGoogle: (returnTo?: string) => Promise<void>;
  /** Signs out this browser, or every device with `'global'`. Either way
   * supabase-js announces SIGNED_OUT here, which forgets the account's data
   * on this device. */
  signOut: (scope?: SignOutScope) => Promise<void>;
  /** Forget a server-deleted account only while it still owns this browser session. */
  forgetDeletedAccount: (userId: string) => boolean;
  /** A sign-in pressed before a reload failed when this document finished it
   * (there is no button of that press left to say so). */
  signInResumeFailed: boolean;
  /** A password-reset link opened this session (supabase-js's
   * PASSWORD_RECOVERY), until it signs out. The app shell then opens
   * /reset-password once, wherever the link landed. */
  passwordRecovery: boolean;
  /** The session ended without the learner choosing it and coding drafts
   * were kept for the account, until a sign-in or `dismissDraftsKept`. */
  draftsKept: boolean;
  dismissDraftsKept: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  // Default throws so a tree missing <AuthProvider> surfaces an error instead
  // of silently doing nothing (which is the bug this contract guards against).
  signInWithGoogle: async () => {
    throw new Error('useAuth must be used within an AuthProvider');
  },
  signOut: async () => {},
  forgetDeletedAccount: () => false,
  signInResumeFailed: false,
  passwordRecovery: false,
  draftsKept: false,
  dismissDraftsKept: () => {},
});

export function AuthProvider({ children, recovery = browserRecovery }: {
  children: ReactNode;
  /** The build check and the reload; tests pass their own. */
  recovery?: Recovery;
}) {
  const [user, setUser] = useState<User | null>(null);
  // No stored session and no OAuth return: the visitor is signed out from the
  // first render, and supabase-js is never downloaded (lib/supabaseClient.ts).
  const [isLoading, setIsLoading] = useState(mayHaveSession);
  const [signInResumeFailed, setSignInResumeFailed] = useState(false);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [draftsKept, setDraftsKept] = useState(false);
  const graceTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(graceTimer.current), []);

  /**
   * Imports supabase-js when needed and leaves for Google. `pressed` is false
   * for the sign-in a reload carried over from the previous document, which
   * never reloads again. The return path stays in sessionStorage until the
   * account arrives, and goes when the sign-in fails here.
   */
  const startSignIn = async (pressed: boolean) => {
    const failedBefore = supabaseLoadFailed();
    let client: SupabaseClient | null;
    try {
      client = await loadSupabase();
    } catch (error) {
      // The download failed before in this document and failed again on this
      // press. A browser that remembers failed module fetches (Chromium up to
      // 155, Safari) answers every later import from memory, so the press
      // reloads the page, and the next document finishes the sign-in.
      if (pressed && failedBefore && isChunkLoadError(error)) {
        markSignInResume();
        if (await reloadOnPress(recovery)) {
          // Busy until the new document arrives. A refused reload (the
          // leave-page prompt) fails the press after all.
          await new Promise((resolve) => { graceTimer.current = window.setTimeout(resolve, RELOAD_GRACE_MS); });
        }
        clearSignInResume();
      }
      clearAuthReturn();
      throw error;
    }
    if (!client) {
      clearAuthReturn();
      throw new Error('Sign-in is not available in this deployment.');
    }
    // On success supabase-js redirects to Google; on failure (e.g. the Google
    // provider isn't enabled, or the redirect URL isn't allow-listed) it
    // returns an error instead of navigating: surface it so the click isn't a
    // silent no-op.
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      clearAuthReturn();
      throw error;
    }
  };

  useEffect(() => {
    // A sign-in is a SIGNED_IN after INITIAL_SESSION; INITIAL_SESSION and
    // TOKEN_REFRESHED are never reported, so the log records real logins. A
    // password-reset link signs in too, announced as PASSWORD_RECOVERY.
    // supabase-js also sends SIGNED_IN for a session it restores from storage,
    // while it initializes and before INITIAL_SESSION. The eager client sent
    // that before this effect ran; a client loaded on demand can attach this
    // listener first, and the order keeps the restore out of the log.
    let initialized = false;
    // supabase-js also says SIGNED_IN for the stored session again each time
    // the tab is shown (`_recoverAndRefresh` on visibilitychange). The
    // per-tab mark below stopped the second of those, not the first, so every
    // new tab of a signed-in learner reported a sign-in on its first return
    // (perf baseline #587, item C30). The session INITIAL_SESSION restored
    // from storage is remembered by its sign-in (signInIdOf), and a SIGNED_IN
    // for that same sign-in is not reported. An OAuth return's INITIAL_SESSION
    // is the new sign-in itself, so nothing is remembered for it.
    let restored: string | null = null;
    // Once the provider hears an Auth event, the boot read can no longer
    // replace the session, even if the older snapshot eventually succeeds.
    let bootCurrent = true;
    const handleAuthChange = (event: AuthChangeEvent, session: Session | null) => {
      bootCurrent = false;
      if (session?.user) signedIn(session.user.id);
      setUser(session?.user ?? null);
      setIsLoading(false);
      if (event === 'INITIAL_SESSION') {
        initialized = true;
        restored = openedOnAuthRedirect ? null : signInIdOf(session);
      }
      const restoredAgain = event === 'SIGNED_IN' && restored !== null && signInIdOf(session) === restored;
      if ((event === 'SIGNED_IN' || event === 'PASSWORD_RECOVERY') && initialized && session?.user && !restoredAgain) reportSignIn();
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      if (event === 'SIGNED_OUT') {
        restored = null;
        setPasswordRecovery(false);
        clearSignInReport();
        // The next person on this device starts from nothing, not from the
        // progress, XP, coins, bookmarks and drafts of the account that left.
        // A session that ended on its own keeps the coding drafts for that
        // account alone, and says so.
        if (accountSignedIn && clearAccountData(signOutChosen() ? null : accountId)) setDraftsKept(true);
        accountSignedIn = false;
        accountId = null;
      }
    };
    const stopAuthEvents = onSupabaseAuthStateChange(handleAuthChange);
    const stopSessionRemoval = onSupabaseSessionRemoved((userId) => {
      if (signedInAccount() === userId) handleAuthChange('SIGNED_OUT', null);
    });
    const unsubscribe = () => {
      bootCurrent = false;
      stopAuthEvents();
      stopSessionRemoval();
    };

    if (!mayHaveSession()) {
      setIsLoading(false);
      // The document before this one reloaded on a sign-in press: finish it.
      if (resumePending) {
        resumePending = false;
        void startSignIn(false).catch(() => setSignInResumeFailed(true));
      }
      return unsubscribe;
    }
    // A session or an OAuth return is here already, so the account arriving
    // is the sign-in a reload carried over, and App takes the return path.
    resumePending = false;

    // The deadline covers the download too: a stalled chunk settles as signed
    // out, like a stalled session read always has.
    void withDeadline(getSupabaseSession(), AUTH_BOOT_TIMEOUT_MS)
      .then((session) => {
        if (!bootCurrent) return;
        if (session?.user) signedIn(session.user.id);
        setUser(session?.user ?? null);
      })
      .catch(() => {
        if (bootCurrent) setUser(null);
      })
      .finally(() => {
        if (bootCurrent) setIsLoading(false);
      });

    return unsubscribe;
  }, []);

  // An account is here. Drafts an involuntary sign-out kept for another
  // account are deleted unread; its own learning-path drafts go back in place
  // now, and its coding drafts come back when it opens a coding task
  // (coding/drafts.ts).
  //
  // An email link or another tab can replace the session of one account with
  // another's without a SIGNED_OUT in between (supabase-js saves the link's
  // session over the stored one). The account that was here leaves the same
  // way a Log out would make it leave: its progress, coins and waiting results
  // must not be merged into the one arriving, and that sign-in is reported.
  function signedIn(id: string) {
    if (accountSignedIn && accountId !== null && accountId !== id) {
      clearSignInReport();
      clearAccountData();
      setPasswordRecovery(false);
    }
    accountSignedIn = true;
    accountId = id;
    forgetOthersKeptDrafts(id);
    removeStored(CHOSEN);
    setDraftsKept(false);
  }

  const signInWithGoogle = async (returnTo?: string) => {
    // A sign-in from anywhere else must not inherit an older page's return.
    clearAuthReturn();
    // A classroom invite (/play/K7Q2AB), a flashcard deck or the GitHub
    // settings page must not turn into the home page on the way back.
    const path = returnTo ?? currentReturnPath();
    if (path) rememberAuthReturn(path);
    // Signing in is when a signed-out visitor downloads supabase-js.
    await startSignIn(true);
  };

  // Log out of this browser without the server: what supabase-js's SIGNED_OUT
  // would have done here, since it announces none.
  const forgetSessionHere = () => {
    forgetStoredSession();
    clearSignInReport();
    clearAccountData();
    accountSignedIn = false;
    accountId = null;
    setPasswordRecovery(false);
    setUser(null);
  };

  function forgetDeletedAccount(userId: string): boolean {
    // The browser's stored session can change before this tab receives the
    // Auth event. The server has already removed the old account, so there
    // is no need for an SDK sign-out that might later pick up a new session.
    const storedUserId = storedSessionUserId();
    if (signedInAccount() !== userId || (storedUserId && storedUserId !== userId)) return false;
    chooseSignOut();
    forgetSessionHere();
    return true;
  }

  // supabase-js signs out every device by default. Log out means this
  // browser; signing out everywhere is its own, explicit action.
  //
  // Offline, or while the sign-in service answers 5xx, supabase-js refuses a
  // local sign-out and keeps the session, so Log out did nothing. Ending the
  // session on this device needs nothing from the server, so it ends here
  // anyway; the server's copy of this session lapses with its refresh token.
  // Signing out everywhere does need the server, and still says it failed.
  const signOut = async (scope: SignOutScope = 'local') => {
    chooseSignOut();
    const client = await supabaseForSession();
    if (!client) {
      // supabase-js could not load (offline, a failed download).
      if (scope === 'local' && hasStoredSession()) forgetSessionHere();
      return;
    }
    const { error } = await client.auth.signOut({ scope });
    if (!error) return;
    if (scope === 'local' && serverUnreachable(error)) {
      forgetSessionHere();
      return;
    }
    removeStored(CHOSEN);
    throw error;
  };

  return (
    <AuthContext.Provider
      value={{ user, isAuthenticated: !!user, isLoading, signInWithGoogle, signOut, forgetDeletedAccount, signInResumeFailed, passwordRecovery, draftsKept, dismissDraftsKept: () => setDraftsKept(false) }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

// Display fields from a Supabase user. Google populates user_metadata; an
// account made with an email and password has no name or picture there.
export function getUserProfile(user: User | null) {
  const meta = user?.user_metadata ?? {};
  const rawPicture = (meta.avatar_url || meta.picture) as string | undefined;
  let picture: string | undefined;
  if (rawPicture) {
    try {
      const url = new URL(rawPicture);
      if (url.protocol === 'https:' && (url.hostname === 'googleusercontent.com' || url.hostname.endsWith('.googleusercontent.com'))) {
        picture = url.toString();
      }
    } catch {
      // Untrusted metadata is rendered as initials instead of loading a tracker.
    }
  }
  return {
    // Never the email: this name can reach a public board, and an address is
    // not a name anybody chose to publish. Without one, a board says "Learner".
    name: (meta.full_name || meta.name) as string | undefined,
    email: user?.email,
    picture,
  };
}
