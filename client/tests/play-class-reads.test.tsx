import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { Context } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { DEFAULT_CONFIG, GAME_CONFIG_KEY } from '../src/lib/gameConfig';
import type { Match } from '../src/lib/play';

// A classroom of thirty pupils and their teacher, all behind one school
// address: thirty-one real match screens in one page, joined by an in-memory
// broadcast channel, against a stand-in for the play API that counts the
// state reads. Every read of the class spends the one address bucket
// (`playState` in lib/rate-limit.ts, 600 a minute). When every answer was
// broadcast and every screen read the room for it, this lesson cost 682
// reads a question and 1,457 in its busiest minute; now 67 and 227.

type Person = { id: string; user_metadata: Record<string, never> };
const PUPILS = 30;
const TEACHER: Person = { id: 'teacher', user_metadata: {} };
const PEOPLE: Person[] = [TEACHER, ...Array.from({ length: PUPILS }, (_, n) => ({ id: `pupil-${n + 1}`, user_metadata: {} }))];
const QUESTION_COUNT = 3;
const READ_LATENCY_MS = 150;
const BROADCAST_LATENCY_MS = 40;

const room = vi.hoisted(() => ({
  status: 'lobby' as 'lobby' | 'running' | 'finished',
  current_index: 0,
  revealed_idx: null as number | null,
  question_started_at: null as string | null,
  answers: new Map<number, Map<string, number>>(),
  reads: [] as Array<{ at: number; question: number }>,
  auth: null as null | Context<{ id: string; user_metadata: Record<string, never> }>,
}));

const QUESTIONS = Array.from({ length: QUESTION_COUNT }, (_, i) => ({
  id: `q${i}`, question: `Question number ${i + 1}?`, options: ['alpha', 'beta', 'gamma'], correct_index: 1,
  explanation: 'Because.', category: 'javascript', difficulty: 1,
}));

// What api/play/[action].ts sends each viewer: the teacher holds the key, a
// pupil only the questions shown so far, without it.
function matchFor(userId: string): Match {
  const shown = room.status === 'running' ? QUESTIONS.slice(0, room.current_index + 1) : room.status === 'finished' ? QUESTIONS : [];
  const questions = userId === TEACHER.id || room.status === 'finished'
    ? QUESTIONS
    : shown.map(({ correct_index: _key, explanation: _why, ...rest }) => rest);
  return {
    id: 'm1', code: 'CLASS1', mode: 'classroom', host_id: TEACHER.id, host_name: 'Teacher', status: room.status,
    current_index: room.current_index, questions, question_count: QUESTIONS.length,
    // Untimed, so thirty-one clocks do not re-render every second; a
    // classroom question waits for the teacher either way.
    question_started_at: room.question_started_at, question_duration_s: 0,
    started_at: room.status === 'lobby' ? null : new Date(0).toISOString(),
    revealed_idx: room.revealed_idx,
  };
}
const participants = PEOPLE.map((person, n) => ({ user_id: person.id, display_name: person.id, joined_at: new Date(n).toISOString() }));
const later = <T,>(ms: number, value: () => T) => new Promise<T>((resolve) => { setTimeout(() => resolve(value()), ms); });

vi.mock('../src/lib/play', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/play')>(),
  joinMatch: ({ user_id }: { user_id: string }) => later(READ_LATENCY_MS, () => ({ ...matchFor(user_id), server_now: new Date().toISOString() })),
  fetchMatchState: (_code: string, userId: string) => {
    room.reads.push({ at: Date.now(), question: room.status === 'running' ? room.current_index : -1 });
    return later(READ_LATENCY_MS, () => ({ match: matchFor(userId), participants, scoreboard: [], server_now: new Date().toISOString() }));
  },
  submitMatchAnswer: ({ user_id, question_idx, selected_idx }: { user_id: string; question_idx: number; selected_idx: number }) => {
    const answers = room.answers.get(question_idx) ?? new Map<string, number>();
    answers.set(user_id, selected_idx);
    room.answers.set(question_idx, answers);
    // A classroom answer is acknowledged, never graded back (056).
    return later(READ_LATENCY_MS, () => ({ ok: true, accepted: true, advanced: false }));
  },
  controlMatch: ({ action }: { action: 'start' | 'advance' | 'finish' | 'reveal' }) => {
    if (action === 'reveal') {
      room.revealed_idx = room.current_index;
      return later(READ_LATENCY_MS, () => ({ ok: true, status: room.status, current_index: room.current_index, revealed_idx: room.current_index }));
    }
    if (action === 'start') {
      room.status = 'running';
      room.current_index = 0;
    } else if (action === 'advance' && room.current_index + 1 < QUESTIONS.length) {
      room.current_index += 1;
    } else {
      room.status = 'finished';
    }
    room.question_started_at = new Date().toISOString();
    return later(READ_LATENCY_MS, () => ({ ok: true, status: room.status, current_index: room.current_index }));
  },
  fetchDistribution: (_code: string, questionIdx: number) => {
    const buckets = new Map<number, number>();
    for (const selected of room.answers.get(questionIdx)?.values() ?? []) buckets.set(selected, (buckets.get(selected) ?? 0) + 1);
    return later(READ_LATENCY_MS, () => ({ buckets: [...buckets].map(([selected_idx, count]) => ({ selected_idx, count, correct: selected_idx === 1 })) }));
  },
  sendHeartbeat: async () => ({ ok: true }),
}));

// Each screen is one person: the auth hook reads who from the tree.
vi.mock('../src/lib/auth', async () => {
  const React = await import('react');
  const auth = React.createContext<Person>(TEACHER);
  room.auth = auth;
  return {
    useAuth: () => ({ user: React.useContext(auth), isAuthenticated: true, isLoading: false, signInWithGoogle: vi.fn() }),
    getUserProfile: () => ({}),
    displayNameFromProfile: (_profile: unknown, fallback: string) => fallback,
  };
});

// One Realtime channel shared by every screen, with `broadcast.self` on as in
// lib/realtime.ts: a broadcast reaches every subscriber, the sender included.
const bus = vi.hoisted(() => ({ listeners: [] as Array<{ event: string; fn: (payload: unknown) => void }>, sent: new Map<string, number>() }));
vi.mock('../src/lib/realtime', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/realtime')>(),
  joinMatchChannel: () => {
    const mine: typeof bus.listeners = [];
    return {
      send: async (event: string, payload: unknown) => {
        bus.sent.set(event, (bus.sent.get(event) ?? 0) + 1);
        setTimeout(() => {
          for (const listener of [...bus.listeners]) if (listener.event === event) listener.fn(payload);
        }, BROADCAST_LATENCY_MS);
      },
      subscribe: (event: string, fn: (payload: unknown) => void) => {
        const listener = { event, fn };
        mine.push(listener);
        bus.listeners.push(listener);
        return () => undefined;
      },
      onStatus: (fn: (status: string) => void) => {
        fn('SUBSCRIBED');
        return () => undefined;
      },
      unsubscribe: () => {
        bus.listeners = bus.listeners.filter((listener) => !mine.includes(listener));
      },
    };
  },
}));

// Thirty-one lobbies drawing their invitation QR code cost seconds and read
// nothing.
vi.mock('qrcode', () => ({ toDataURL: async () => 'data:image/png;base64,' }));

const { PlayMatch } = await import('../src/components/Play');

afterEach(() => vi.useRealTimers());

const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const screenOf = (person: Person) => within(screen.getByTestId(person.id));

describe('a classroom of thirty behind one address', () => {
  it('reads the room a few dozen times a question, and every pupil sees every question', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
    client.setQueryData(GAME_CONFIG_KEY, { ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, multiplayer: true } });
    const Auth = room.auth!;
    await act(async () => {
      render(
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/play/CLASS1']}>
            <LanguageProvider>
              {PEOPLE.map((person) => (
                <section key={person.id} data-testid={person.id}>
                  <Auth.Provider value={person}>
                    <Routes><Route path="/play/:code" element={<PlayMatch />} /></Routes>
                  </Auth.Provider>
                </section>
              ))}
            </LanguageProvider>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await tick(READ_LATENCY_MS); // Join before starting the room reader.
    await tick(2_000);
    expect(screenOf(TEACHER).getByRole('heading', { name: 'Lobby' })).toBeInTheDocument();

    const perQuestion: number[] = [];
    const lateScreens: string[] = [];
    fireEvent.click(screenOf(TEACHER).getByRole('button', { name: `Start (${QUESTION_COUNT} questions)` }));
    for (let q = 0; q < QUESTION_COUNT; q += 1) {
      const opened = room.reads.length;
      // Every screen shows the question within a second of the teacher's click.
      await tick(1_000);
      for (const person of PEOPLE) {
        if (!screenOf(person).queryByText(`Question number ${q + 1}?`)) lateScreens.push(`${person.id} on question ${q + 1}`);
      }
      // The pupils answer over ten seconds, three every second. (A text query:
      // role queries over thirty-one screens are slow in jsdom.)
      const pupils = PEOPLE.slice(1);
      for (let first = 0; first < pupils.length; first += 3) {
        for (const pupil of pupils.slice(first, first + 3)) fireEvent.click(screenOf(pupil).getByText('beta'));
        await tick(1_000);
      }
      // The teacher gives the class half a minute in all, reveals the answer,
      // which closes the question on every screen within a second, and moves on.
      await tick(18_000);
      expect(room.answers.get(q)?.size).toBe(PUPILS);
      fireEvent.click(screenOf(TEACHER).getByRole('button', { name: 'Reveal answer' }));
      await tick(1_000);
      for (const pupil of pupils) {
        if (!screenOf(pupil).queryByText('Closed')) lateScreens.push(`${pupil.id} closing question ${q + 1}`);
      }
      perQuestion.push(room.reads.length - opened);
      fireEvent.click(screenOf(TEACHER).getByRole('button', { name: q === QUESTION_COUNT - 1 ? 'Show results' : 'Next question →' }));
    }
    await tick(2_000);
    expect(screenOf(PEOPLE[PUPILS]).getByRole('heading', { name: 'Match complete' })).toBeInTheDocument();

    // The busiest minute of the lesson, as the address bucket sees it.
    const times = room.reads.map((read) => read.at);
    const busiestMinute = Math.max(...times.map((start) => times.filter((at) => at >= start && at < start + 60_000).length));
    console.log(`state reads per question: ${perQuestion.join(', ')}; busiest minute: ${busiestMinute}; broadcasts: ${JSON.stringify(Object.fromEntries(bus.sent))}`);

    expect(lateScreens).toEqual([]);
    // Each screen reads once for the new question, once when the teacher
    // closes it, and once on its 30 s healing poll: about 3 × 31. A classroom
    // scoreboard counts only closed questions (056), so the answers coming in
    // send nothing and set off no read.
    for (const reads of perQuestion) expect(reads).toBeLessThanOrEqual(3 * PEOPLE.length);
    expect(busiestMinute).toBeLessThan(300);
    // One broadcast per change of question and per reveal, none per answer.
    expect(bus.sent.get('match_updated')).toBe(2 * QUESTION_COUNT + 1);
    expect(bus.sent.get('answered')).toBeUndefined();
  }, 60_000); // thirty-one screens in one page
});
