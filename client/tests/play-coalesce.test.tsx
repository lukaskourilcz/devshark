import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { coalesceReads } from '../src/lib/realtime';
import type { Match } from '../src/lib/play';

// A Classroom answer broadcasts `match_updated` to every client. Each client
// keeps one state read in flight and follows a burst with one trailing read.

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

// Lets settled promises run their callbacks.
const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); });

describe('coalesceReads', () => {
  it('runs one read for a single request', async () => {
    const read = vi.fn(() => Promise.resolve());
    const reader = coalesceReads(read);
    await reader.request();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('folds a burst during a read into one trailing read', async () => {
    const pending = [deferred(), deferred()];
    let calls = 0;
    const read = vi.fn(() => pending[calls++].promise);
    const reader = coalesceReads(read);

    const first = reader.request();
    const burst = Array.from({ length: 30 }, () => reader.request());
    expect(read).toHaveBeenCalledTimes(1);
    // Every request made during the read waits on the same trailing read.
    expect(new Set(burst).size).toBe(1);

    pending[0].resolve();
    await first;
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(2);
    pending[1].resolve();
    await Promise.all(burst);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('keeps going after a failed read', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('429')).mockResolvedValue(undefined);
    const reader = coalesceReads(read);
    const first = reader.request();
    const trailing = reader.request();
    await expect(first).resolves.toBeUndefined();
    await trailing;
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('never starts the trailing read once cancelled', async () => {
    const pending = deferred();
    const read = vi.fn(() => pending.promise);
    const reader = coalesceReads(read);
    const first = reader.request();
    const trailing = reader.request();
    reader.cancel();
    pending.resolve();
    await first;
    await trailing;
    expect(read).toHaveBeenCalledTimes(1);
    await reader.request();
    expect(read).toHaveBeenCalledTimes(1);
  });
});

// A stand-in for the loaded Supabase client's Realtime part. Like
// realtime-js it hands a join of a topic the channel it is still leaving,
// and a subscribe on a channel that is leaving does nothing.
const sb = vi.hoisted(() => {
  type Binding = { event: string; fn: (message: { event: string; payload: unknown }) => void };
  type Fake = { topic: string; state: 'new' | 'joined' | 'leaving'; bindings: Binding[]; on: unknown; subscribe: unknown; send: unknown };
  const channels = new Map<string, Fake>();
  const leaves: Array<() => void> = [];
  const client = {
    channel: (topic: string) => {
      const existing = channels.get(topic);
      if (existing) return existing;
      const made: Fake = {
        topic, state: 'new', bindings: [],
        on: (_type: string, filter: { event: string }, fn: Binding['fn']) => { made.bindings.push({ event: filter.event, fn }); return made; },
        subscribe: (fn: (status: string) => void) => {
          if (made.state === 'new') { made.state = 'joined'; fn('SUBSCRIBED'); }
          return made;
        },
        send: async ({ event, payload }: { event: string; payload: unknown }) => {
          made.bindings.forEach((binding) => { if (binding.event === '*' || binding.event === event) binding.fn({ event, payload }); });
        },
      };
      channels.set(topic, made);
      return made;
    },
    removeChannel: (channel: Fake) => {
      channel.state = 'leaving';
      return new Promise<string>((done) => { leaves.push(() => { channels.delete(channel.topic); done('ok'); }); });
    },
  };
  return { client: null as typeof client | null, fake: client, channels, leaves };
});
vi.mock('../src/lib/supabaseClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/supabaseClient')>(),
  loadedSupabase: () => sb.client,
}));

describe('a match channel', () => {
  beforeEach(() => {
    sb.client = sb.fake;
    sb.channels.clear();
    sb.leaves.length = 0;
  });
  afterEach(() => { sb.client = null; });
  const real = () => vi.importActual<typeof import('../src/lib/realtime')>('../src/lib/realtime');

  it('stops calling a listener once it unsubscribes', async () => {
    const { joinMatchChannel } = await real();
    const channel = joinMatchChannel('ROOM01');
    const heard: unknown[] = [];
    const stop = channel.subscribe('match_updated', (payload) => heard.push(payload));
    await channel.send('match_updated', 1);
    stop();
    await channel.send('match_updated', 2);
    expect(heard).toEqual([1]);
  });

  it('connects a room reopened while its last channel is still being left, once the leave is done', async () => {
    const { joinMatchChannel } = await real();
    joinMatchChannel('ROOM02').unsubscribe();
    await flush();
    const again = joinMatchChannel('ROOM02');
    const statuses: string[] = [];
    again.onStatus((status) => statuses.push(status));
    const heard: unknown[] = [];
    again.subscribe('participant_joined', (payload) => heard.push(payload));
    sb.leaves.forEach((leave) => leave());
    await flush();
    expect(statuses).toEqual(['CONNECTING', 'SUBSCRIBED']);
    await again.send('participant_joined', { sub: 'student' });
    expect(heard).toEqual([{ sub: 'student' }]);
  });
});

const LOBBY: Match = {
  id: 'm1', code: 'ABC123', mode: 'classroom', host_id: 'teacher', host_name: 'Teacher',
  status: 'lobby', current_index: 0, questions: [],
};
const STATE = { match: LOBBY, participants: [], scoreboard: [] };

const api = vi.hoisted(() => ({ joinMatch: vi.fn(), fetchMatchState: vi.fn(), sendHeartbeat: vi.fn() }));
vi.mock('../src/lib/play', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/play')>(),
  ...api,
}));
const USER = { id: 'student', user_metadata: {} };
vi.mock('../src/lib/auth', () => ({
  useAuth: () => ({ user: USER, isAuthenticated: true, isLoading: false, signInWithGoogle: vi.fn() }),
  getUserProfile: () => null,
  displayNameFromProfile: (_profile: unknown, fallback: string) => fallback,
}));
// A channel whose broadcasts the test fires by hand.
const live = vi.hoisted(() => ({ listeners: new Map<string, () => void>(), unsubscribed: 0 }));
vi.mock('../src/lib/realtime', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/realtime')>(),
  joinMatchChannel: () => ({
    send: async () => undefined,
    subscribe: (event: string, fn: () => void) => {
      live.listeners.set(event, fn);
      return () => undefined;
    },
    onStatus: (fn: (status: string) => void) => {
      fn('SUBSCRIBED');
      return () => undefined;
    },
    unsubscribe: () => { live.unsubscribed += 1; },
  }),
}));

const { PlayMatch } = await import('../src/components/Play');

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })}>
      <MemoryRouter initialEntries={['/play/ABC123']}>
        <LanguageProvider>
          <Routes><Route path="/play/:code" element={<PlayMatch />} /></Routes>
        </LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const broadcast = () => act(() => { live.listeners.get('match_updated')!(); });

// Mounts the match and waits for the join's own state read, then counts only
// the reads the broadcasts set off.
async function joined() {
  const view = mount();
  await flush();
  expect(api.fetchMatchState).toHaveBeenCalledTimes(1);
  api.fetchMatchState.mockClear();
  return view;
}

beforeEach(() => {
  live.listeners.clear();
  live.unsubscribed = 0;
  api.joinMatch.mockResolvedValue(LOBBY);
  api.fetchMatchState.mockReset().mockResolvedValue(STATE);
  api.sendHeartbeat.mockResolvedValue({ ok: true });
});

describe('the match screen under a burst of broadcasts', () => {
  it('reads the state once for a single broadcast', async () => {
    await joined();
    await broadcast();
    await flush();
    expect(api.fetchMatchState).toHaveBeenCalledTimes(1);
    expect(api.fetchMatchState).toHaveBeenCalledWith('ABC123', 'student', expect.any(AbortSignal));
  });

  it('turns 30 broadcasts during a read into one read in flight and one trailing read', async () => {
    await joined();
    const inFlight = deferred();
    const trailing = deferred();
    api.fetchMatchState
      .mockImplementationOnce(() => inFlight.promise.then(() => STATE))
      .mockImplementationOnce(() => trailing.promise.then(() => STATE));

    for (let i = 0; i < 30; i += 1) await broadcast();
    expect(api.fetchMatchState).toHaveBeenCalledTimes(1);

    inFlight.resolve();
    await flush();
    expect(api.fetchMatchState).toHaveBeenCalledTimes(2);
    trailing.resolve();
    await flush();
    expect(api.fetchMatchState).toHaveBeenCalledTimes(2);
  });

  it('aborts the current read and drops the trailing read when the screen unmounts', async () => {
    const view = await joined();
    const inFlight = deferred();
    api.fetchMatchState.mockImplementationOnce(() => inFlight.promise.then(() => STATE));

    await broadcast();
    await broadcast();
    await broadcast();
    const signal = api.fetchMatchState.mock.calls[0][2] as AbortSignal | undefined;
    view.unmount();
    expect(signal?.aborted).toBe(true);
    expect(live.unsubscribed).toBe(1);

    inFlight.resolve();
    await flush();
    expect(api.fetchMatchState).toHaveBeenCalledTimes(1);
  });
});
