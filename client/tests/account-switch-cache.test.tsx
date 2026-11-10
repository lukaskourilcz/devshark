// The cached reads of an account that leaves must never draw for the one
// that arrives. Several shared keys carry no account id (the wallet, the due
// concepts, the saved flashcards), so the cache is emptied when the account
// changes, before the next account's first render: emptied in an effect
// after that render, the previous learner's data had already been drawn, and
// the observers kept showing it until something else re-rendered them.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { queryClient } from '../src/lib/queryClient';
import { accountEpoch, beforeAccountChange } from '../src/lib/accountData';

type Listener = (event: string, session: unknown) => void;
const auth = vi.hoisted(() => ({ listeners: new Set<(event: string, session: unknown) => void>() }));
vi.mock('../src/lib/supabaseClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/supabaseClient')>()),
  mayHaveSession: () => false,
  onSupabaseAuthStateChange: (listener: Listener) => {
    auth.listeners.add(listener);
    return () => { auth.listeners.delete(listener); };
  },
}));

const { AuthProvider, useAuth } = await import('../src/lib/auth');

const session = (id: string) => ({ access_token: `token-${id}`, user: { id, email: `${id}@example.test`, user_metadata: {} } });
const emit = (event: string, value: unknown) => act(() => { auth.listeners.forEach((listener) => listener(event, value)); });

const KEY = ['coins-probe'];
const drawn: [string | null, unknown][] = [];
function Probe() {
  const { user } = useAuth();
  // Never fetches on its own: only data the cache already holds can draw.
  const { data } = useQuery({ queryKey: KEY, queryFn: () => new Promise<never>(() => {}), enabled: false });
  drawn.push([user?.id ?? null, data]);
  return null;
}

// TanStack Query tells its observers in a later task.
const seed = (value: string) => act(async () => {
  queryClient.setQueryData(KEY, value);
  await new Promise((resolve) => setTimeout(resolve, 0));
});

function mount() {
  drawn.length = 0;
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider><Probe /></AuthProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  auth.listeners.clear();
  queryClient.clear();
});

describe('an account change empties the query cache before the next account draws', () => {
  it('when another account replaces the session without a sign-out', async () => {
    mount();
    emit('SIGNED_IN', session('ada'));
    await seed('ada coins');
    expect(drawn[drawn.length - 1]).toEqual(['ada', 'ada coins']);

    emit('SIGNED_IN', session('bob'));
    expect(drawn.filter(([id]) => id === 'bob').length).toBeGreaterThan(0);
    expect(drawn.filter(([id, data]) => id === 'bob' && data !== undefined)).toEqual([]);
    expect(queryClient.getQueryData(KEY)).toBeUndefined();
  });

  it('still forgets private storage when settling a pending draft fails', async () => {
    mount();
    emit('SIGNED_IN', session('ada'));
    await seed('ada coins');
    localStorage.setItem('devshark:coding:draft:html-1', '// Ada only');
    const oldEpoch = accountEpoch();
    const stopBroken = beforeAccountChange(() => { throw new Error('draft unavailable'); });
    const settleOther = vi.fn();
    const stopOther = beforeAccountChange(settleOther);
    try {
      emit('SIGNED_IN', session('bob'));
      expect(settleOther).toHaveBeenCalledOnce();
      expect(accountEpoch()).toBeGreaterThan(oldEpoch);
      expect(localStorage.getItem('devshark:coding:draft:html-1')).toBeNull();
      expect(drawn.at(-1)).toEqual(['bob', undefined]);
    } finally {
      stopOther();
      stopBroken();
    }
  });

  it('when the account signs out', async () => {
    mount();
    emit('SIGNED_IN', session('ada'));
    await seed('ada coins');

    expect(drawn[drawn.length - 1]).toEqual(['ada', 'ada coins']);
    emit('SIGNED_OUT', null);
    const signedOut = drawn.slice(drawn.findIndex(([id, data]) => id === 'ada' && data !== undefined) + 1)
      .filter(([id]) => id === null);
    expect(signedOut.length).toBeGreaterThan(0);
    expect(signedOut.filter(([, data]) => data !== undefined)).toEqual([]);
  });
});
