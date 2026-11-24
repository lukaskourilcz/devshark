import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Banner } from '@astryxdesign/core/Banner';
import { friendlyError } from '../../lib/api';
import { verifyAdminAccess } from '../../lib/devApi';
import { useAuth } from '../../lib/auth';
import { openSignIn } from '../../lib/signInDialog';
import './DevConsole.css';

/** Sign in or retry the current account’s administrative access. */
export default function DevLogin({ onSuccess }: { onSuccess: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { isAuthenticated } = useAuth();

  const checkAccount = async () => {
    setError(null);
    if (!isAuthenticated) {
      openSignIn();
      return;
    }
    setSubmitting(true);
    try {
      if (await verifyAdminAccess()) onSuccess();
      else setError('This account does not have administrative access.');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="dev-login-page">
      <div className="dev-login-card">
        <span className="dev-brand-fin" aria-hidden="true" />
        <span className="dev-eyebrow">Shark platform control room</span>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0 0 4px', color: 'var(--color-text-primary)' }}>
          Welcome back
        </h1>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', margin: '0 0 24px' }}>
          Continue with an approved admin account.
        </p>

        {error && (
          <div style={{ marginBottom: 16 }}>
            <Banner status="error" title={error} />
          </div>
        )}

        <Button
          type="button"
          variant="primary"
          label={isAuthenticated ? 'Check admin access' : 'Continue with Google'}
          onClick={checkAccount}
          isDisabled={submitting}
          isLoading={submitting}
          style={{ width: '100%', marginBottom: 18 }}
        />
      </div>
    </div>
  );
}
