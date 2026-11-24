import { useCallback, useRef, useState } from 'react';
import { render, screen } from '@testing-library/react';
import { it, onTestFinished, vi } from 'vitest';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import MobileNavigation from '../src/components/MobileNavigation';
import { MobileNavigationStatus } from '../src/components/MobileNavigationStatus';
import { checkEscapeReturn } from './dialog-escape';

it.each(['ready', 'loading', 'retry'] as const)('returns to the mobile menu opener after Escape in the %s drawer', async (phase) => {
  const rect = new DOMRect(0, 0, 44, 44);
  // jsdom has no layout. All controls in this fixture are visible at mobile width.
  const layout = vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue(
    Object.assign([rect], { item: (index: number) => index === 0 ? rect : null }),
  );
  onTestFinished(() => layout.mockRestore());
  function Entry() {
    const [open, setOpen] = useState(false);
    const opener = useRef<HTMLButtonElement>(null);
    const onClose = useCallback(() => setOpen(false), []);
    const state = { open, opener: opener.current, onClose };
    return <>
      <button ref={opener} onClick={() => setOpen(true)}>Open navigation</button>
      {phase === 'ready'
        ? <MobileNavigation {...state}><a href="/learn">Learn</a></MobileNavigation>
        : <MobileNavigationStatus {...state} busy={phase === 'loading'} retry={phase === 'retry' ? onClose : undefined} />}
    </>;
  }
  render(<LanguageProvider><Entry /></LanguageProvider>);
  await checkEscapeReturn(screen.getByRole('button', { name: 'Open navigation' }), 'dialog', /^Dismiss$/);
});
