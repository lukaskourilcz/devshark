import { Link } from 'react-router-dom';
import { useT } from '../../i18n/LanguageContext';
import { BreadcrumbList, type BreadcrumbItem } from './BreadcrumbList';
import './Breadcrumb.css';

export type { BreadcrumbItem } from './BreadcrumbList';

export function Breadcrumb({ items, className }: { items: readonly BreadcrumbItem[]; className?: string }) {
  const t = useT();
  return <BreadcrumbList items={items} className={className} label={t('nav.breadcrumb')} renderLink={(href, text) => <Link to={href}>{text}</Link>} />;
}
