import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { it, vi } from 'vitest';
import AuthButton from '../src/components/AuthButton';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { checkEscapeReturn } from './dialog-escape';

vi.mock('../src/lib/auth', async (load) => ({
  ...await load<typeof import('../src/lib/auth')>(),
  useAuth: () => ({
    user: { id: 'signed-in-learner', user_metadata: { name: 'Test Learner' } },
    isAuthenticated: true, isLoading: false, signOut: vi.fn(),
  }),
}));
vi.mock('../src/lib/rewards', () => ({ useWallet: () => ({ data: null }) }));
vi.mock('../src/lib/shop', () => ({ useEquippedRingColor: () => null }));

it('restores focus to the signed-in account menu after Escape', async () => {
  render(<MemoryRouter><LanguageProvider><AuthButton /></LanguageProvider></MemoryRouter>);
  await checkEscapeReturn(screen.getByRole('button', { name: 'Account menu for Test' }), 'dialog');
});
