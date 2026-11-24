import { useEffect, useState } from 'react';

/** Show the loading label immediately and announce it after the status exists. */
export function LoadingLabel({ children }: { children: string }) {
  const [announcing, setAnnouncing] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setAnnouncing(true), 0);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <span role="status" aria-live="polite">
      {announcing ? children : <span aria-hidden="true">{children}</span>}
    </span>
  );
}
