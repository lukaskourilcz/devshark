import { loadedSupabase } from './supabaseClient';

// Thin wrapper around Supabase Realtime broadcast channels for live matches.
// Falls back to a no-op subscription if Supabase isn't configured so callers
// still work locally — they will just not receive live events. Only a
// signed-in player opens a match channel, and restoring or starting that
// session loaded the client (lib/supabaseClient.ts), so it is read
// synchronously here.

type Listener<T = unknown> = (payload: T) => void;

export interface RealtimeChannel {
  send: (event: string, payload: unknown) => Promise<void>;
  subscribe: <T = unknown>(event: string, fn: Listener<T>) => () => void;
  onStatus: (fn: Listener<string>) => () => void;
  unsubscribe: () => void;
}

const noop = () => undefined;

// A room's channel still being left, per topic. Supabase hands a new join of
// a topic the channel it is still leaving (until the server acknowledges the
// leave), and a subscribe on that channel does nothing: reopening a room just
// left (Back, then the same code) got a channel that never connected and
// never heard a broadcast. A new join of that topic waits for the leave.
const leaving = new Map<string, Promise<unknown>>();

export function joinMatchChannel(code: string): RealtimeChannel {
  const client = loadedSupabase();
  if (!client) {
    return {
      send: async () => undefined,
      subscribe: () => noop,
      onStatus: (fn) => {
        fn('DISCONNECTED');
        return noop;
      },
      unsubscribe: noop,
    };
  }

  const topic = `match:${code}`;
  // Each caller's listeners live here, so each subscribe has a real
  // unsubscribe, and the channel carries one binding for all of them.
  const listeners = new Map<string, Set<Listener>>();
  const statusListeners = new Set<Listener<string>>();
  let currentStatus = 'CONNECTING';
  let closed = false;
  let channel: ReturnType<typeof client.channel> | null = null;

  const open = () => {
    if (closed) return;
    const opened = client.channel(topic, {
      config: { private: true, broadcast: { self: true } },
    });
    opened.on('broadcast', { event: '*' }, (message: { event: string; payload: unknown }) => {
      if (closed) return;
      listeners.get(message.event)?.forEach((listener) => listener(message.payload));
    });
    opened.subscribe((status) => {
      if (closed) return;
      currentStatus = status;
      statusListeners.forEach((listener) => listener(status));
    });
    channel = opened;
  };
  const previous = leaving.get(topic);
  const ready: Promise<void> = previous ? previous.then(open, open) : Promise.resolve(open());

  return {
    send: async (event, payload) => {
      await ready;
      if (closed || !channel || currentStatus !== 'SUBSCRIBED') return;
      await channel.send({ type: 'broadcast', event, payload });
    },
    subscribe: <T,>(event: string, fn: Listener<T>) => {
      const set = listeners.get(event) ?? new Set<Listener>();
      listeners.set(event, set);
      const listener = fn as Listener;
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
    onStatus: (fn) => {
      statusListeners.add(fn);
      fn(currentStatus);
      return () => statusListeners.delete(fn);
    },
    unsubscribe: () => {
      if (closed) return;
      closed = true;
      statusListeners.clear();
      listeners.clear();
      const left: Promise<unknown> = ready
        .then(() => (channel ? client.removeChannel(channel) : undefined))
        .catch(noop);
      leaving.set(topic, left);
      void left.then(() => {
        if (leaving.get(topic) === left) leaving.delete(topic);
      });
    },
  };
}

export interface CoalescedRead {
  // Ask for a read. Resolves once a read that started after this call ends.
  request: () => Promise<void>;
  // Stop for good: a queued trailing read never starts.
  cancel: () => void;
}

// A burst of broadcasts (a room changing question, a class joining the lobby)
// would otherwise send one state read per broadcast per client. This keeps at
// most one read in flight and folds every request that lands meanwhile into a
// single trailing read, which starts after the last broadcast and so always
// fetches the final state.
export function coalesceReads(read: () => Promise<void>): CoalescedRead {
  let inFlight: Promise<void> | null = null;
  let trailing: Promise<void> | null = null;
  let cancelled = false;

  const start = (): Promise<void> => {
    const current = read()
      .catch(noop)
      .then(() => {
        inFlight = null;
      });
    inFlight = current;
    return current;
  };

  return {
    request: () => {
      if (cancelled) return Promise.resolve();
      if (!inFlight) return start();
      if (!trailing) {
        trailing = inFlight.then(() => {
          trailing = null;
          return cancelled ? undefined : start();
        });
      }
      return trailing;
    },
    cancel: () => {
      cancelled = true;
    },
  };
}

export interface TrailingThrottle {
  /** Ask for a run: the first request of a quiet spell schedules one `waitMs`
   * later, and the requests that land before it runs join it. */
  request: () => void;
  /** Stop for good: a scheduled run never starts. */
  cancel: () => void;
}

// A class answering one question sends the host a stream of `answered`
// events. This turns the stream into at most one run per `waitMs`, and the
// last event is always followed by a run within `waitMs`.
export function trailingThrottle(run: () => void, waitMs: number): TrailingThrottle {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;
  return {
    request: () => {
      if (cancelled || timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        if (!cancelled) run();
      }, waitMs);
    },
    cancel: () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
