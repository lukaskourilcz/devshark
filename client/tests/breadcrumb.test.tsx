import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { Breadcrumb, type BreadcrumbItem } from '../src/components/ui/Breadcrumb';
const show = (items: BreadcrumbItem[]) => render(<LanguageProvider><MemoryRouter><Breadcrumb items={items} /></MemoryRouter></LanguageProvider>);
describe('Breadcrumb ancestry', () => {
  it('omits the landmark on a root page', () => {
    show([{ label: 'Today' }]);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
  it('keeps the current leaf when there are two values', () => {
    show([{ label: 'Coding', href: '/coding' }, { label: 'JavaScript' }]);
    expect(screen.getByRole('link', { name: 'Coding' })).toHaveAttribute('href', '/coding');
    expect(screen.getByText('JavaScript')).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link', { name: 'JavaScript' })).not.toBeInTheDocument();
  });
  it('preserves a filtered parent URL and has one current item', () => {
    show([{ label: 'Coding', href: '/coding' }, { label: 'JavaScript', href: '/coding/javascript?q=loop' }, { label: 'digitSum.js' }]);
    expect(screen.getByRole('link', { name: 'JavaScript' })).toHaveAttribute('href', '/coding/javascript?q=loop');
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(screen.getAllByText('/').every(e => e.getAttribute('aria-hidden') === 'true')).toBe(true);
  });
});
