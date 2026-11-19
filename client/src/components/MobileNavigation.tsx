import { useCallback, useRef, useState, type ReactNode } from 'react';
import { m, AnimatePresence, MotionProvider, useReducedMotion } from '../lib/motion';
import { useT } from '../i18n/LanguageContext';
import { useDrawerFocus } from './MobileNavigationStatus';
import { CloseIcon } from './ui/icons';
import './MobileNavigation.css';

/** Loaded on the first menu press, after the ordinary shell is interactive. */
export default function MobileNavigation({ open, opener, onClose, children }: {
  open: boolean;
  opener: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const reduce = useReducedMotion();
  const [featuresReady, setFeaturesReady] = useState(false);
  const markReady = useCallback(() => setFeaturesReady(true), []);
  const panel = useRef<HTMLDivElement>(null);
  useDrawerFocus(open, panel, opener, onClose);
  return <MotionProvider onReady={markReady}><AnimatePresence>
    {open && <m.div className="ss-show-mobile" initial={featuresReady ? { opacity: 0 } : false} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
      <div className="ss-drawer-backdrop" onClick={onClose} />
      <m.div ref={panel} className="ss-drawer-panel"
        initial={featuresReady ? (reduce ? { opacity: 0 } : { x: '-100%' }) : false}
        animate={reduce ? { opacity: 1 } : { x: 0 }}
        exit={reduce ? { opacity: 0 } : { x: '-100%' }}
        transition={reduce ? { duration: 0.12 } : { type: 'spring', stiffness: 440, damping: 42 }}
        role="dialog" aria-modal="true" aria-label={t('nav.menuTitle')} tabIndex={-1} onClick={onClose}>
        <button type="button" className="ss-drawer-close" aria-label={t('common.dismiss')} onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}><CloseIcon size={20} /></button>
        {children}
      </m.div>
    </m.div>}
  </AnimatePresence></MotionProvider>;
}
