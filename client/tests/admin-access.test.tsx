import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '../src/i18n/LanguageContext';
const state = vi.hoisted(() => ({ user: { id: 'owner' } as { id: string } | null, verify: vi.fn() }));
vi.mock('../src/lib/auth', async original => ({ ...await original<typeof import('../src/lib/auth')>(), useAuth: () => ({ user: state.user, isLoading: false }) }));
vi.mock('../src/lib/devApi', async original => ({ ...await original<typeof import('../src/lib/devApi')>(), verifyPassword: state.verify }));
vi.mock('../src/components/dev/DevLogin', () => ({ default: () => <h1>Administrative access required</h1> }));
import DevAccess from '../src/components/dev/DevAccess';

describe('the shared administration gate', () => {
  it('discards private cached users and unmounts the workspace when the account changes', async () => {
    state.user = { id: 'owner' }; state.verify.mockResolvedValue(true);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const app = () => <QueryClientProvider client={client}><LanguageProvider><DevAccess>{() => <p>Private directory</p>}</DevAccess></LanguageProvider></QueryClientProvider>;
    const view = render(app());
    expect(await screen.findByText('Private directory')).toBeInTheDocument();
    client.setQueryData(['admin', 'users', 1], { email: 'private@example.invalid' });
    state.user = { id: 'learner' }; state.verify.mockResolvedValue(false);
    view.rerender(app());
    expect(await screen.findByText('Administrative access required')).toBeInTheDocument();
    expect(screen.queryByText('Private directory')).toBeNull();
    await waitFor(() => expect(client.getQueryData(['admin', 'users', 1])).toBeUndefined());
  });
});
