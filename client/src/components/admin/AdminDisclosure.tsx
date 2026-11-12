import type { ReactNode } from 'react';

/**
 * Details that stay out of the way until someone asks for them (admin UX review, 12 November 2026).
 * A native `details` element: it works with the keyboard and without JavaScript, and assistive
 * technology announces whether it is expanded.
 */
export function AdminDisclosure({ summary, children, defaultOpen = false, className, testId }: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  testId?: string;
}) {
  return <details className={className ? 'admin-disclosure ' + className : 'admin-disclosure'} open={defaultOpen || undefined} data-testid={testId}>
    <summary>{summary}</summary>
    <div className="admin-disclosure-body">{children}</div>
  </details>;
}
