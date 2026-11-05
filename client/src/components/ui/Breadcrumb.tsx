import { Link } from 'react-router-dom';
import { useT } from '../../i18n/LanguageContext';
import './Breadcrumb.css';

export interface BreadcrumbItem { label: string; href?: string }

/** A root has no ancestry. Keep the current leaf when a real parent exists. */
export function Breadcrumb({ items, className = '' }: { items: readonly BreadcrumbItem[]; className?: string }) {
  const t = useT();
  if (items.length < 2) return null;
  return (
    <nav aria-label={t('nav.breadcrumb')} className={`ss-breadcrumb ${className}`}>
      <ol>
        {items.map((item, index) => (
          <li key={`${item.href ?? ''}:${index}`}>
            {index > 0 && <span className="ss-breadcrumb__separator" aria-hidden="true">/</span>}
            {index < items.length - 1 && item.href
              ? <Link to={item.href}>{item.label}</Link>
              : <span aria-current={index === items.length - 1 ? 'page' : undefined}>{item.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
