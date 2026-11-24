// Where the app shell sends a learner once an account arrives.
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import { isAuthLandingPath, RESET_PASSWORD_PATH, takeAuthReturn } from './authReturn';

/**
 * Two moves, both made by App:
 *
 *  * back to the page that asked for the sign-in (/premium, the checkout
 *    success page). Supabase always returns a Google sign-in to the origin;
 *    lib/authReturn.ts holds the path for fifteen minutes in this tab only.
 *    The pages an email link opens keep the learner: they say what happened
 *    and offer the way on themselves;
 *  * to /reset-password when a reset link opened a recovery session. Supabase
 *    sends that link there, or to the home page when the address is not on
 *    its allow-list; either way the learner lands on the form, once.
 */
export function useAuthLanding(user: User | null, passwordRecovery: boolean): void {
  const navigate = useNavigate();
  useEffect(() => {
    if (!user) return;
    const path = takeAuthReturn();
    if (isAuthLandingPath(window.location.pathname)) return;
    if (path && path !== window.location.pathname + window.location.search) navigate(path, { replace: true });
  }, [user, navigate]);

  const recoveryShown = useRef(false);
  useEffect(() => {
    if (!passwordRecovery) {
      recoveryShown.current = false;
      return;
    }
    if (recoveryShown.current) return;
    recoveryShown.current = true;
    if (window.location.pathname !== RESET_PASSWORD_PATH) navigate(RESET_PASSWORD_PATH, { replace: true });
  }, [passwordRecovery, navigate]);
}
