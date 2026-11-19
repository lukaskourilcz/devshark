import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import RegisterPromptSnackbar from '../src/components/RegisterPromptSnackbar';

vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ isAuthenticated: false, isLoading: false }) }));
const openSignIn = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/signInDialog', async (importOriginal) => ({ ...(await importOriginal<object>()), openSignIn }));
vi.mock('../src/lib/gameConfig', () => ({ useGameConfig: () => ({ coins: { welcomeGrant: 200 } }) }));
// The card loads on demand (lazyShellPart); with its module already here, it
// draws once the act that opens it has let the lazy import settle.
beforeAll(async () => { await import('../src/components/RegisterPromptCard'); });
const showAfter = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); };
afterEach(async () => {
  cleanup();
  // Finish the captured jsdom RAF tick before its fake interval is removed.
  if (vi.isFakeTimers()) await act(async () => { await vi.runOnlyPendingTimersAsync(); });
  vi.useRealTimers();
  sessionStorage.clear();
  openSignIn.mockClear();
});

it('lets a guest read without a timed overlay, then offers registration after interaction', async () => {
  vi.useFakeTimers();
  render(<MemoryRouter><LanguageProvider><RegisterPromptSnackbar /></LanguageProvider></MemoryRouter>);
  act(() => { vi.advanceTimersByTime(10_000); });
  expect(screen.queryByRole('region')).toBeNull();
  fireEvent.keyDown(window, { key: 'Tab' });
  await showAfter(2500);
  expect(screen.getByRole('region')).toBeInTheDocument();
});

it('promises to save what a guest earns from now on, not what they earned signed out', async () => {
  // Signing in replaces this device's guest XP and Learn levels with the account's.
  vi.useFakeTimers();
  render(<MemoryRouter><LanguageProvider><RegisterPromptSnackbar /></LanguageProvider></MemoryRouter>);
  fireEvent.pointerDown(window);
  await showAfter(2500);
  const prompt = screen.getByRole('region', { name: 'Save your progress from now on' });
  expect(prompt).toHaveTextContent('Sign in so the XP and streak you earn from now on are saved to your account. +200 coins.');
  expect(prompt).not.toHaveTextContent(/keep your XP/i);
});

it('cancels the scheduled prompt when unmounted', () => {
  vi.useFakeTimers();
  const view = render(<MemoryRouter><LanguageProvider><RegisterPromptSnackbar /></LanguageProvider></MemoryRouter>);
  fireEvent.pointerDown(window);
  view.unmount();
  act(() => { vi.advanceTimersByTime(3000); });
  expect(screen.queryByRole('region')).toBeNull();
});

// "Sign in" hands over to the sign-in dialog (Google, or an email and
// password) and the prompt steps aside for the rest of the session.
it('opens the sign-in dialog and steps aside', async () => {
  vi.useFakeTimers();
  render(<MemoryRouter><LanguageProvider><RegisterPromptSnackbar /></LanguageProvider></MemoryRouter>);
  fireEvent.pointerDown(window);
  await showAfter(2500);
  const prompt = screen.getByRole('region', { name: 'Save your progress from now on' });
  fireEvent.click(within(prompt).getByRole('button', { name: 'Sign in' }));
  expect(openSignIn).toHaveBeenCalledTimes(1);
  await showAfter(1000);
  expect(screen.queryByRole('region')).toBeNull();
  expect(sessionStorage.getItem('devquiz:register-prompt:dismissed:v1')).toBe('1');
});

// The visitor found the sign-in dialog some other way (the header's Log in):
// the prompt does not come up behind it, or after it, this session.
it('stays away once the sign-in dialog has been opened', async () => {
  const store = await vi.importActual<typeof import('../src/lib/signInDialog')>('../src/lib/signInDialog');
  vi.useFakeTimers();
  render(<MemoryRouter><LanguageProvider><RegisterPromptSnackbar /></LanguageProvider></MemoryRouter>);
  fireEvent.pointerDown(window);
  act(() => { vi.advanceTimersByTime(1000); });
  act(() => store.openSignIn());
  act(() => { vi.advanceTimersByTime(5000); });
  expect(screen.queryByRole('region')).toBeNull();
  act(() => store.closeSignIn());
  act(() => { vi.advanceTimersByTime(5000); });
  expect(screen.queryByRole('region')).toBeNull();
  expect(sessionStorage.getItem('devquiz:register-prompt:dismissed:v1')).toBe('1');
});
