import { createPortal } from 'react-dom';
import { useEffect } from 'react';
import { useT } from '../../i18n/LanguageContext';
import { CloseIcon } from './icons';
import { ToastMotion } from './ToastMotion';

/**
 * Lightweight toast — a MUI-free replacement for the app's `<Snackbar><Alert>`
 * pattern. Controlled via `open`/`onClose`, fixed bottom-centre, auto-hides,
 * and colour-codes by severity using the Astryx design tokens (success uses the
 * active subject accent). Renders through a portal so it floats above the app.
 */
export type ToastSeverity = 'success' | 'error' | 'info';

const STYLES: Record<ToastSeverity, { accent: string }> = {
  success: { accent: 'var(--brand-accent, #2d7a2d)' },
  error: { accent: 'var(--ss-error)' },
  info: { accent: 'var(--ss-info)' },
};

export function AppToast({
  open,
  onClose,
  message,
  severity = 'info',
  autoHideDuration = 5000,
}: {
  open: boolean;
  onClose: () => void;
  message: React.ReactNode;
  severity?: ToastSeverity;
  autoHideDuration?: number | null;
}) {
  const t = useT();
  useEffect(() => {
    if (!open || autoHideDuration == null) return;
    const id = window.setTimeout(onClose, autoHideDuration);
    return () => window.clearTimeout(id);
  }, [open, autoHideDuration, onClose]);

  if (typeof document === 'undefined') return null;
  const s = STYLES[severity];

  return createPortal(
    <div
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        // Above the cookie banner while it shows (CookieConsent.tsx).
        bottom: 'calc(max(1rem, env(safe-area-inset-bottom)) + var(--ss-consent-dock, 0px))',
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 1400,
        padding: '0 1rem',
      }}
    >
      {/* The live region stays on the page and the card is inserted into it:
          a region drawn together with its words, as the card was, is not
          read. It takes its role only while it has words, so a page with
          closed toasts holds no empty alerts. Empty, it has no width, so the
          card centres as before. */}
      <div
        role={open ? (severity === 'error' ? 'alert' : 'status') : undefined}
        aria-live={severity === 'error' ? 'assertive' : 'polite'}
        style={{ display: 'flex', justifyContent: 'center', minWidth: 0 }}
      >
        <ToastMotion
          open={open}
          kind="app"
          style={{
            pointerEvents: 'auto',
            maxWidth: 'min(92vw, 460px)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 16px',
            borderRadius: 'var(--radius-element, 0.9rem)',
            background: 'var(--color-background-surface)',
            color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-family-body)',
            fontWeight: 700,
            fontSize: '0.9rem',
            boxShadow: '0 14px 44px rgba(var(--ss-ink-rgb), .2)',
            border: '1px solid var(--color-border)',
            borderLeft: `4px solid ${s.accent}`,
            borderBottom: `2px solid ${s.accent}`,
          }}
        >
          <span style={{ flex: 1 }}>{message}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.dismiss')}
            style={{
              appearance: 'none',
              border: 'none',
              background: 'transparent',
              color: 'inherit',
              cursor: 'pointer',
              opacity: 0.75,
              width: 44,
              height: 44,
              display: 'grid',
              placeItems: 'center',
              padding: 0,
              borderRadius: 8,
            }}
          >
            <CloseIcon size={17} />
          </button>
        </ToastMotion>
      </div>
    </div>,
    document.body,
  );
}
