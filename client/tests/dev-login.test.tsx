// /dev's access check: a signed-in account without the admin role is told so,
// not asked to sign in, and the console closes when the account changes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import DevLogin from '../src/components/dev/DevLogin';
import AdminPage from '../src/components/admin/AdminPage';
import { server } from './mocks/server';

const auth = vi.hoisted(() => ({
  value: { user: { id: 'learner-1' } as { id: string } | null, isAuthenticated: true, isLoading: false },
}));
vi.mock('../src/lib/auth', () => ({ useAuth: () => auth.value }));
afterEach(() => { auth.value = { user: { id: 'learner-1' }, isAuthenticated: true, isLoading: false }; });

describe('/admin → access check', () => {
  it('tells a signed-in account without the admin role that it has no access', async () => {
    server.use(http.get('*/api/admin/settings', () => HttpResponse.json(
      { error: { code: 'forbidden', message: 'Administrative access required' } },
      { status: 403 },
    )));
    const onSuccess = vi.fn();
    render(<LanguageProvider><DevLogin onSuccess={onSuccess} /></LanguageProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Check admin access' }));
    expect(await screen.findByText('This account does not have administrative access.')).toBeInTheDocument();
    expect(screen.queryByText('You need to sign in to do that.')).toBeNull();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});

describe('/admin → the console', () => {
  it('closes and checks access again when the signed-in account changes', async () => {
    let admin = true;
    server.use(
      http.get('*/api/admin/settings', () => (admin
        ? HttpResponse.json({ settings: {} })
        : HttpResponse.json({ error: { code: 'forbidden', message: 'Administrative access required' } }, { status: 403 }))),
      http.get('*/api/admin/questions', () => HttpResponse.json({ questions: [], categories: [], reportCounts: {} })),
    );
    auth.value = { user: { id: 'admin-1' }, isAuthenticated: true, isLoading: false };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const page = () => (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/admin/questions']}>
          <LanguageProvider><AdminPage /></LanguageProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
    const { rerender } = render(page());
    expect(await screen.findByRole('heading', { level: 1, name: 'Question bank' })).toBeInTheDocument();
    // The admin signs out on another tab; this one hears it from auth.
    admin = false;
    auth.value = { user: null, isAuthenticated: false, isLoading: false };
    rerender(page());
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Question bank' })).toBeNull();
  });
});
