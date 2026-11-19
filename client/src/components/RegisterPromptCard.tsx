// The card of the guest nudge (RegisterPromptSnackbar.tsx). It loads only
// when the nudge first opens, so a first visit does not download it.
//
// Docked to the top-right so it never covers the hero CTA. Rendered on a
// crisp white surface (the same in light + dark modes) so it reads as a
// distinct product moment against the dark chrome.

import { createPortal } from 'react-dom';
import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import { m, AnimatePresence, MotionProvider, useReducedMotion, stillIfReduced } from '../lib/motion';
import { useIsMobile } from '../lib/useMediaQuery';
import { useT } from '../i18n/LanguageContext';
import { useGameConfig } from '../lib/gameConfig';
import { SharkFin } from './SharkFin';

const CloseIcon = () => (
  <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

function RegisterPromptCard({ open, onClose, onSignIn }: {
  open: boolean;
  onClose: () => void;
  onSignIn: () => void;
}) {
  const reduce = useReducedMotion();
  const t = useT();
  // The welcome coins as the owner configured them (#227); 0 drops the offer.
  const welcomeCoins = useGameConfig().coins.welcomeGrant;
  const isMobile = useIsMobile();

  if (typeof document === 'undefined') return null;

  // Sits below the toolbar's floating utility icons, leaves a comfortable gutter
  // from the right edge on desktop and phones.
  const gutter = isMobile ? 12 : 20;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: gutter,
        right: gutter,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 10,
        zIndex: 1400,
        pointerEvents: 'none',
      }}
    >
      <AnimatePresence>
        {open && (
          <m.div
            key="register-card"
            role="region"
            aria-label={t('register.title')}
            className="ss-register-prompt"
            initial={stillIfReduced(reduce, { opacity: 0, x: 40 })}
            animate={stillIfReduced(reduce, { opacity: 1, x: 0 })}
            exit={stillIfReduced(reduce, { opacity: 0, x: 40 })}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            style={{
              pointerEvents: 'auto',
              position: 'relative',
              width: 320,
              maxWidth: 'calc(100vw - 24px)',
              color: 'var(--color-text-primary)',
              backgroundColor: 'var(--color-background-surface)',
              borderRadius: 18,
              boxShadow: '0 18px 48px rgba(var(--ss-ink-rgb), .2)',
              border: '1px solid var(--color-border)',
              borderBottom: '3px solid var(--brand-accent)',
              padding: '20px',
              maxHeight: 'calc(100dvh - 24px)',
              overflowY: 'auto',
            }}
          >
            <button
              type="button"
              aria-label={t('register.dismiss')}
              onClick={onClose}
              style={{
                position: 'absolute',
                top: 6,
                right: 6,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                appearance: 'none',
                border: 'none',
                background: 'transparent',
                color: 'var(--color-text-secondary)',
                cursor: 'pointer',
                padding: 0,
                width: 44,
                height: 44,
                lineHeight: 0,
              }}
            >
              <CloseIcon />
            </button>
            <div style={{ display: 'flex', flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginBottom: 10, paddingRight: 24 }}>
              <div style={{ marginTop: 2 }}>
                <SharkFin size={22} color={'var(--brand-accent)'} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Text as="div" type="body" weight="bold" color="primary">
                  {t('register.title')}
                </Text>
                <Text as="div" type="supporting" color="secondary">
                  {welcomeCoins > 0 ? t('register.body', { tokens: String(welcomeCoins) }) : t('register.bodyNoCoins')}
                </Text>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
              <Button variant="ghost" label={t('register.dismiss')} onClick={onClose} />
              <Button variant="primary" label={t('register.cta')} onClick={onSignIn} />
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>,
    document.body,
  );
}

export default function RegisterPromptCardWithMotion(props: Parameters<typeof RegisterPromptCard>[0]) {
  return <MotionProvider><RegisterPromptCard {...props} /></MotionProvider>;
}
