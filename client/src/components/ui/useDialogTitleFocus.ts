import { useEffect, useRef } from 'react';

/** The native dialog must already be open before its heading can take focus. */
export function useDialogTitleFocus(open: boolean, step?: string) {
  const header = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) header.current?.querySelector<HTMLElement>('h2')?.focus();
  }, [open, step]);
  return header;
}
