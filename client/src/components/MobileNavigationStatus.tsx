import { useEffect, useRef, type RefObject } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { useT } from '../i18n/LanguageContext';
import { CloseIcon } from './ui/icons';

/** Layout visibility, not offsetParent: the drawer itself is fixed-position. */
function visibleTarget(element: HTMLElement | null): element is HTMLElement {
  return Boolean(element?.isConnected && element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== 'hidden' && !element.closest('[inert]') &&
    !element.matches(':disabled'));
}

function restoreDrawerFocus(panel: HTMLElement, opener: HTMLElement | null) {
  if (visibleTarget(opener)) {
    opener.focus({ preventScroll: true });
    return;
  }
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body &&
      !panel.contains(active) && visibleTarget(active)) return;
  [
    document.querySelector<HTMLElement>('nav.ss-nav-center a[aria-current="page"]'),
    document.querySelector<HTMLElement>('header.ss-header a.ss-header-brand'),
    document.getElementById('main-content'),
  ].find(visibleTarget)?.focus({ preventScroll: true });
}

/** Both the cold menu and its loaded renderer keep the same modal contract. */
export function useDrawerFocus(
  open: boolean,
  panelRef: RefObject<HTMLDivElement | null>,
  opener: HTMLElement | null,
  onClose: () => void,
) {
  useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel || !visibleTarget(panel)) return;
    const focusables = () => Array.from(panel.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter(visibleTarget);
    (focusables()[0] ?? panel).focus();
    const onKey = (event: KeyboardEvent) => {
      // CSS can hide the panel before React processes the media-query change.
      if (!visibleTarget(panel)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      } else if (event.key === 'Tab') {
        const list = focusables();
        const first = list[0] ?? panel;
        const last = list[list.length - 1] ?? panel;
        const active = document.activeElement;
        if (event.shiftKey && (active === first || active === panel || !panel.contains(active))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      restoreDrawerFocus(panel, opener);
    };
  }, [open, panelRef, opener, onClose]);
}

/** Navigation remains dismissible while its animation/runtime chunk arrives. */
export function MobileNavigationStatus({ open, opener, onClose, retry, busy = false }: {
  open: boolean;
  opener: HTMLElement | null;
  onClose: () => void;
  retry?: () => void;
  busy?: boolean;
}) {
  const t = useT();
  const panel = useRef<HTMLDivElement>(null);
  useDrawerFocus(open, panel, opener, onClose);
  if (!open) return null;
  return <div className="ss-show-mobile">
    <div className="ss-drawer-backdrop" onClick={onClose} />
    <div ref={panel} className="ss-drawer-panel" role="dialog" aria-modal="true" aria-label={t('nav.menuTitle')} tabIndex={-1}>
      <button type="button" className="ss-drawer-close" aria-label={t('common.dismiss')} onClick={onClose}>
        <CloseIcon size={20} />
      </button>
      {retry ? <>
        <p role="alert">{t('nav.menuError')}</p>
        <Button variant="secondary" size="md" label={t('error.tryAgain')} isLoading={busy} isInterruptible onClick={retry}>
          {t('error.tryAgain')}
        </Button>
      </> : <p role="status">{t('common.loading')}</p>}
    </div>
  </div>;
}
