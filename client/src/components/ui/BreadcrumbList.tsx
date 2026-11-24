import type { ReactNode } from 'react';

export interface BreadcrumbItem { label: string; href?: string }

/** A root has no ancestry. Keep the current leaf when a real parent exists. */
export function BreadcrumbList({ items, label, className = '', renderLink }: {
  items: readonly BreadcrumbItem[];
  label: string;
  className?: string;
  renderLink: (href: string, text: string) => ReactNode;
}) {
  if (items.length < 2) return null;
  return (
    <nav aria-label={label} className={`ss-breadcrumb ${className}`}>
      <ol>
        {items.map((item, index) => (
          <li key={`${item.href ?? ''}:${index}`}>
            {index > 0 && <span className="ss-breadcrumb__separator" aria-hidden="true">/</span>}
            {index < items.length - 1 && item.href
              ? renderLink(item.href, item.label)
              : <span aria-current={index === items.length - 1 ? 'page' : undefined}>{item.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
