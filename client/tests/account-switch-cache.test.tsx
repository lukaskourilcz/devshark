// The cached reads of an account that leaves must never draw for the one
// that arrives. Several shared keys carry no account id (the wallet, the due
// concepts, the saved flashcards), so the cache is emptied when the account
// changes, before the next account's first render: emptied in an effect
// after that render, the previous learner's data had already been drawn, and
// the observers kept showing it until something else re-rendered them.
//
// The inventory further down lists every query key root in client/src, says
// whether the key carries the account id, holds caller data that only the
// clear removes, or is the same for every caller, and checks each one. A scan
// of the source fails when a key appears that the inventory does not list.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { QueryClientProvider, useQuery, type QueryKey } from '@tanstack/react-query';
import { queryClient } from '../src/lib/queryClient';
import { accountEpoch, beforeAccountChange, clearAccountData } from '../src/lib/accountData';
import { codingKeys } from '../src/coding/api';
import { codingDraftQuery } from '../src/coding/drafts';
import { practiceKeys } from '../src/coding/practice';
import { learnLessonQuery } from '../src/components/learn/lessonQuery';
import { adminDirectoryKey } from '../src/lib/adminDirectory';
import { dailyQuestionQuery } from '../src/lib/dailyQuestion';
import { eligibilityKeys } from '../src/lib/eligibility';
import { entitlementKeys } from '../src/lib/entitlement';
import { GAME_CONFIG_KEY } from '../src/lib/gameConfig';
import { leaderboardVisibilityQuery } from '../src/lib/leaderboardVisibility';
import { learningPathKeys } from '../src/lib/learningPaths';
import {
  challengeLeaderboardQuery, conceptDueQuery, flashcardsQuery, leaderboardQuery, profileStatsQueryKey, roadmapStructureQuery,
} from '../src/lib/queries';
import { referralKey } from '../src/lib/referral';
import { rewardKeys } from '../src/lib/rewards';

type Listener = (event: string, session: unknown) => void;
const auth = vi.hoisted(() => ({ listeners: new Set<(event: string, session: unknown) => void>() }));
vi.mock('../src/lib/supabaseClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/supabaseClient')>()),
  mayHaveSession: () => false,
  supabaseForSession: async () => null,
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
let signOut!: ReturnType<typeof useAuth>['signOut'];
function Probe() {
  const account = useAuth();
  signOut = account.signOut;
  const { user } = account;
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
      expect(drawn[drawn.length - 1]).toEqual(['bob', undefined]);
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


it('reports global sign-out unavailable when the Auth client cannot load', async () => {
  mount();
  emit('SIGNED_IN', session('ada'));
  await expect(signOut('global')).rejects.toThrow('Authentication service is unavailable');
  expect(localStorage.getItem('devshark:signed-out-by-choice')).toBeNull();
  expect(drawn[drawn.length - 1][0]).toBe('ada');
});

/* ── The inventory of query keys ─────────────────────────────────────────── */

// account: the key carries the account id, so another account never reads it.
// cleared: caller data under a key without the account id; only the clear on
//   an account change (lib/auth.tsx registers queryClient.clear() with
//   beforeAccountChange, which clearAccountData runs) keeps it from the next
//   account.
// public: the same answer for every caller (lib/api.ts isPublicRead, or a
//   static file), safe to keep.
type KeyClass = 'account' | 'cleared' | 'public';
interface KeyEntry {
  /** The key's leading literal parts, as the source scan reads them. */
  prefix: readonly string[];
  class: KeyClass;
  /** A real key under the prefix, built by the app's own factory where there is one. */
  key: (accountId: string) => QueryKey;
  what: string;
}

const KEY_INVENTORY: KeyEntry[] = [
  { prefix: ['profile-stats'], class: 'account', key: (id) => profileStatsQueryKey(id), what: 'Profile stats (lib/queries.ts)' },
  { prefix: ['entitlement'], class: 'account', key: (id) => entitlementKeys.user(id), what: 'Premium entitlement (lib/entitlement.ts)' },
  { prefix: ['learning-path', 'enrollments'], class: 'account', key: (id) => learningPathKeys.enrollments(id), what: 'path enrollments (lib/learningPaths.ts)' },
  { prefix: ['learning-path', 'progress'], class: 'account', key: (id) => learningPathKeys.progress(id, 'enrollment-1', 1), what: 'path progress (lib/learningPaths.ts)' },
  { prefix: ['leaderboard-name'], class: 'account', key: (id) => leaderboardVisibilityQuery(id).queryKey, what: 'leaderboard name and photo setting (lib/leaderboardVisibility.ts)' },
  { prefix: ['big-o-introduction'], class: 'account', key: (id) => ['big-o-introduction', 1, 0, id], what: 'the Big-O introduction level (components/learn/BigOIntroduction.tsx)' },

  { prefix: ['flashcards'], class: 'cleared', key: () => flashcardsQuery('webdev').queryKey, what: 'Shark Cards deck (lib/queries.ts)' },
  { prefix: ['concept-due'], class: 'cleared', key: () => conceptDueQuery.queryKey, what: 'concepts due for review (lib/queries.ts)' },
  { prefix: ['eligibility'], class: 'cleared', key: () => eligibilityKeys.all, what: 'learning-path eligibility (lib/eligibility.ts)' },
  { prefix: ['rewards', 'wallet'], class: 'cleared', key: () => rewardKeys.wallet(), what: 'coin wallet (lib/rewards.ts)' },
  { prefix: ['rewards', 'shop'], class: 'cleared', key: () => rewardKeys.shop(), what: 'shop with owned items (lib/rewardsShop.ts)' },
  { prefix: ['rewards', 'orders'], class: 'cleared', key: () => rewardKeys.orders(), what: 'reward orders (lib/rewardsShop.ts)' },
  { prefix: ['rewards', 'referral'], class: 'cleared', key: () => referralKey, what: 'invite link and referrals (lib/referral.ts)' },
  { prefix: ['streak-protection'], class: 'cleared', key: () => ['streak-protection'], what: 'streak protection: the shop invalidates it after a purchase, Profile reads it outside the cache (lib/rewardsShop.ts)' },
  { prefix: ['coding', 'task'], class: 'cleared', key: () => codingKeys.task('html-1'), what: 'a coding task with the learner\'s state (coding/api.ts)' },
  { prefix: ['coding', 'approaches'], class: 'cleared', key: () => codingKeys.approaches('html-1'), what: 'approaches the learner unlocked (coding/api.ts)' },
  { prefix: ['coding', 'progress'], class: 'cleared', key: () => codingKeys.progress(), what: 'coding progress (coding/api.ts)' },
  { prefix: ['coding', 'github'], class: 'cleared', key: () => codingKeys.github(), what: 'GitHub garden connection (coding/api.ts)' },
  { prefix: ['coding', 'bookmarks'], class: 'cleared', key: () => practiceKeys.bookmarks(), what: 'saved challenges (coding/practice.ts)' },
  { prefix: ['coding', 'session'], class: 'cleared', key: () => practiceKeys.session(), what: 'practice session (coding/practice.ts)' },
  { prefix: ['coding', 'draft'], class: 'cleared', key: () => codingDraftQuery('html-1').queryKey, what: 'account draft of a coding task (coding/drafts.ts)' },
  { prefix: ['leaderboard'], class: 'cleared', key: () => leaderboardQuery({ period: 'global', categories: ['javascript'] }).queryKey, what: 'leaderboard boards with the caller\'s rank (lib/queries.ts)' },
  { prefix: ['daily-question'], class: 'cleared', key: () => dailyQuestionQuery('today').queryKey, what: 'the daily question\'s sealed session (lib/dailyQuestion.ts)' },
  { prefix: ['admin'], class: 'cleared', key: () => adminDirectoryKey(1), what: 'admin screens (components/dev, components/admin)' },

  { prefix: ['game-config'], class: 'public', key: () => GAME_CONFIG_KEY, what: 'game settings, /api/settings (lib/gameConfig.ts)' },
  { prefix: ['roadmap', 'structure'], class: 'public', key: () => roadmapStructureQuery.queryKey, what: 'the Learn map (lib/queries.ts)' },
  { prefix: ['learning-path', 'catalog'], class: 'public', key: () => learningPathKeys.catalog(), what: 'published path manifests (lib/learningPaths.ts)' },
  { prefix: ['learn-lesson'], class: 'public', key: () => learnLessonQuery('html-1').queryKey, what: 'a Learn level\'s lesson (components/learn/lessonQuery.ts)' },
  { prefix: ['coding', 'brief'], class: 'public', key: () => codingKeys.brief('html-1'), what: 'a coding task\'s brief (coding/api.ts)' },
  { prefix: ['challenge', 'leaderboard'], class: 'public', key: () => challengeLeaderboardQuery('webdev').queryKey, what: 'Challenge top ten and champion (lib/queries.ts)' },
  { prefix: ['triage', 'verdicts'], class: 'public', key: () => ['triage', 'verdicts'], what: 'the static triage verdicts file (components/dev/DevTriage.tsx)' },
];

const callerKeys = KEY_INVENTORY.filter((entry) => entry.class !== 'public');
const startsWith = (key: QueryKey, prefix: readonly unknown[]) => prefix.every((part, index) => key[index] === part);
const label = (entry: KeyEntry) => `[${entry.prefix.join(', ')}]`;

/** Seeds every caller-data key the way `accountId` would have it. */
function seedCallerKeys(accountId: string) {
  for (const entry of callerKeys) queryClient.setQueryData(entry.key(accountId), { owner: accountId });
}

/** Which caller-data entries hold data in the cache right now. */
const heldNow = () => {
  const keys = queryClient.getQueryCache().getAll().filter((query) => query.state.data !== undefined).map((query) => query.queryKey);
  return callerKeys.filter((entry) => keys.some((key) => startsWith(key, entry.prefix))).map(label);
};

// Reads the cache during render, so it sees exactly what the next account's
// first render could draw, without waiting for an observer to be told.
const held: [string | null, string[]][] = [];
function CacheProbe() {
  const { user } = useAuth();
  held.push([user?.id ?? null, heldNow()]);
  return null;
}

describe('every caller-data query key is scoped by account or cleared on an account change', () => {
  it('lists a real key for each entry under its prefix, and an account key names the account', () => {
    for (const entry of KEY_INVENTORY) {
      expect(startsWith(entry.key('ada'), entry.prefix), label(entry)).toBe(true);
      if (entry.class !== 'account') continue;
      expect(entry.key('ada'), label(entry)).toContain('ada');
      expect(entry.key('bob'), label(entry)).not.toEqual(entry.key('ada'));
    }
  });

  it('empties each one before the next account\'s first render, on a sign-in over another account and on a sign-out', async () => {
    held.length = 0;
    render(<QueryClientProvider client={queryClient}><AuthProvider><CacheProbe /></AuthProvider></QueryClientProvider>);
    emit('SIGNED_IN', session('ada'));
    await act(async () => { seedCallerKeys('ada'); });
    expect(heldNow()).toEqual(callerKeys.map(label));

    emit('SIGNED_IN', session('bob'));
    const bobRenders = held.filter(([id]) => id === 'bob');
    expect(bobRenders.length).toBeGreaterThan(0);
    expect(bobRenders[0][1], 'keys still holding ada\'s data when bob first rendered').toEqual([]);
    expect(heldNow()).toEqual([]);

    await act(async () => { seedCallerKeys('bob'); });
    const before = held.length;
    emit('SIGNED_OUT', null);
    const signedOut = held.slice(before).filter(([id]) => id === null);
    expect(signedOut.length).toBeGreaterThan(0);
    expect(signedOut[0][1], 'keys still holding bob\'s data when the signed-out page first rendered').toEqual([]);
  });

  it('empties each one when clearAccountData runs on its own (an account deletion)', async () => {
    render(<QueryClientProvider client={queryClient}><AuthProvider><CacheProbe /></AuthProvider></QueryClientProvider>);
    seedCallerKeys('ada');
    expect(heldNow()).toEqual(callerKeys.map(label));
    clearAccountData();
    expect(heldNow()).toEqual([]);
  });
});

/* ── The source scan ─────────────────────────────────────────────────────── */

// Reads every key client/src writes: an array after `queryKey:` or passed to
// setQueryData, getQueryData or getQueryState, and the key factories those
// name (`codingKeys.task(id)`, `GAME_CONFIG_KEY`, a local `const key = ...`).
// A key is known by its leading string literals, at most two. A shape the
// scan cannot read fails the test too, so a new factory cannot slip past it.

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const IDENT = /^[A-Za-z_$][\w$]*/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const path = join(dir, item.name);
    if (item.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(item.name) && !item.name.endsWith('.d.ts') ? [path] : [];
  });
}

/** Strips comments, keeping offsets for the rest. */
const withoutComments = (text: string) => text
  .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (line, lead: string) => lead + ' '.repeat(line.length - lead.length));

interface Definition { text: string; at: number }
/** One key expression: the keys it can be (two for `a ? x : y`), a key read
 * from elsewhere (`.queryKey`), or a shape the scan cannot read. */
type Read = { keys: string[][] } | { skip: true } | { error: string };

class KeyScanner {
  readonly found: { file: string; parts: string[] }[] = [];
  readonly errors: string[] = [];

  constructor(private readonly files: Map<string, string>) {}

  /** Where `name` is declared: with `const` or `let` in the file itself, or
   * exported from another file (an import can only bring an export). */
  private definition(name: string, file: string): Definition | null {
    const escaped = name.replace(/\$/g, '\\$');
    const look = (text: string, exported: boolean) => {
      const declared = new RegExp(`${exported ? '\\bexport\\s+const' : '\\b(?:const|let)'}\\s+${escaped}\\s*(?::[^=]+)?=\\s*`);
      const match = declared.exec(text);
      return match ? { text, at: match.index + match[0].length } : null;
    };
    const own = look(this.files.get(file)!, false);
    if (own) return own;
    const others = [...this.files.entries()].filter(([path]) => path !== file).map(([, text]) => look(text, true)).filter(Boolean) as Definition[];
    return others[0] ?? null;
  }

  /** The index of the `:` that ends the consequent starting at `at`. */
  private alternate(text: string, at: number): number {
    let depth = 0;
    for (let index = at; index < text.length; index += 1) {
      const char = text[index];
      if (char === '(' || char === '[' || char === '{') depth += 1;
      else if (char === ')' || char === ']' || char === '}') {
        if (depth === 0) return -1;
        depth -= 1;
      } else if (char === ':' && depth === 0) return index;
    }
    return -1;
  }

  /** An object member's value, for `factory.member`. */
  private member(object: Definition, name: string): Definition | null {
    let depth = 0;
    for (let index = object.at; index < object.text.length; index += 1) {
      const char = object.text[index];
      if (char === '{' || char === '[' || char === '(') depth += 1;
      else if (char === '}' || char === ']' || char === ')') {
        depth -= 1;
        if (depth === 0) break;
      } else if (depth === 1 && object.text.startsWith(name, index) && !/[\w$]/.test(object.text[index - 1])) {
        const rest = object.text.slice(index + name.length).match(/^\s*:\s*/);
        if (rest) return { text: object.text, at: index + name.length + rest[0].length };
      }
    }
    return null;
  }

  /** The leading literals of the key expression that starts at `at`. */
  read(text: string, at: number, file: string, seen = 0): Read {
    if (seen > 6) return { error: 'a key factory refers to itself' };
    let rest = text.slice(at);
    // An arrow factory: `(id) => [...]`.
    const arrow = rest.match(/^\([^)]*\)\s*=>\s*/);
    if (arrow) rest = rest.slice(arrow[0].length);
    const start = at + text.slice(at).length - rest.length;
    // `user ? keys.user(user.id) : keys.all`: both branches are keys.
    const condition = rest.match(/^!?[A-Za-z_$][\w$.]*\s*\?(?![.?])\s*/);
    if (condition) {
      const consequent = start + condition[0].length;
      const colon = this.alternate(text, consequent);
      if (colon < 0) return { error: `cannot read ${rest.slice(0, 60)}` };
      const branches = [this.read(text, consequent, file, seen + 1), this.read(text, colon + 1 + (text.slice(colon + 1).match(/^\s*/)?.[0].length ?? 0), file, seen + 1)];
      const failed = branches.find((branch) => 'error' in branch);
      if (failed) return failed;
      return { keys: branches.flatMap((branch) => ('keys' in branch ? branch.keys : [])) };
    }
    if (rest.startsWith('[')) {
      const parts: string[] = [];
      let index = 1;
      while (parts.length < 2) {
        const literal = rest.slice(index).match(/^\s*'([^'\n]*)'\s*(,|\]|as\b)?/);
        if (literal) {
          parts.push(literal[1]);
          index += literal[0].length;
          if (literal[2] !== ',') break;
          continue;
        }
        const spread = rest.slice(index).match(/^\s*\.\.\./);
        if (spread && parts.length === 0) {
          const inner = this.read(text, start + index + spread[0].length, file, seen + 1);
          if (!('keys' in inner)) return inner;
          if (inner.keys.length !== 1) return { error: `a spread of two keys in ${rest.slice(0, 60)}` };
          parts.push(...inner.keys[0]);
          const after = rest.slice(index + spread[0].length).match(/^[^,\]]*,?/);
          index += spread[0].length + (after?.[0].length ?? 0);
          if (!after?.[0].endsWith(',')) break;
          continue;
        }
        break;
      }
      return parts.length > 0 ? { keys: [parts.slice(0, 2)] } : { error: `no literal root in ${rest.slice(0, 60)}` };
    }
    const name = rest.match(IDENT)?.[0];
    if (!name) return { error: `cannot read ${rest.slice(0, 60)}` };
    const tail = rest.slice(name.length);
    // `options(...).queryKey` and `context.queryKey` read a key written elsewhere.
    if (/^(\([^)]*\))?\.queryKey\b/.test(tail)) return { skip: true };
    const definition = this.definition(name, file);
    if (!definition) return { error: `${name} is not declared in client/src` };
    const member = tail.match(/^\.([A-Za-z_$][\w$]*)/)?.[1];
    if (member) {
      if (!definition.text.slice(definition.at).startsWith('{')) return { error: `${name} is not an object of key factories` };
      const value = this.member(definition, member);
      return value ? this.read(value.text, value.at, file, seen + 1) : { error: `${name}.${member} is not declared` };
    }
    return this.read(definition.text, definition.at, file, seen + 1);
  }

  scan() {
    const sites = /\bqueryKey\s*:\s*|\.(?:setQueryData|getQueryData|getQueryState)\s*(?:<[^()]*?>)?\(\s*/g;
    for (const [file, text] of this.files) {
      for (const site of text.matchAll(sites)) {
        const result = this.read(text, site.index + site[0].length, file);
        const where = `${relative(SRC, file)}:${text.slice(0, site.index).split('\n').length}`;
        if ('keys' in result) for (const parts of result.keys) this.found.push({ file: where, parts });
        else if ('error' in result) this.errors.push(`${where}: ${result.error}`);
      }
    }
    return this;
  }
}

const covers = (entry: KeyEntry, parts: string[]) =>
  startsWith(parts, entry.prefix) || startsWith(entry.prefix as QueryKey, parts);

function scanSources(extra: [string, string][] = []) {
  const files = new Map(sourceFiles(SRC).map((path) => [path, withoutComments(readFileSync(path, 'utf8'))] as [string, string]));
  for (const [path, text] of extra) files.set(path, withoutComments(text));
  return new KeyScanner(files).scan();
}

describe('the query key inventory matches client/src', () => {
  const scan = scanSources();

  it('reads every key the source writes', () => {
    expect(scan.errors).toEqual([]);
    expect(scan.found.length).toBeGreaterThan(60);
  });

  it('lists every key root the source writes', () => {
    const missing = scan.found.filter(({ parts }) => !KEY_INVENTORY.some((entry) => covers(entry, parts)));
    expect(missing.map(({ file, parts }) => `${file} [${parts.join(', ')}]`), 'add these keys to KEY_INVENTORY with their class').toEqual([]);
  });

  it('lists no key the source no longer writes', () => {
    const unused = KEY_INVENTORY.filter((entry) => !scan.found.some(({ parts }) => covers(entry, parts)));
    expect(unused.map(label)).toEqual([]);
  });

  it('notices a new key root and a new factory', () => {
    const scratch = join(SRC, 'scratch-probe.ts');
    const literal = scanSources([[scratch, "useQuery({ queryKey: ['scratch-root', id], queryFn });"]]);
    expect(literal.found.filter(({ parts }) => !KEY_INVENTORY.some((entry) => covers(entry, parts))).map(({ parts }) => parts))
      .toEqual([['scratch-root']]);
    const factory = scanSources([[scratch, "const scratchKeys = { one: (id: string) => ['coding', 'scratch', id] as const };\nuseQuery({ queryKey: scratchKeys.one(id), queryFn });"]]);
    expect(factory.found.filter(({ parts }) => !KEY_INVENTORY.some((entry) => covers(entry, parts))).map(({ parts }) => parts))
      .toEqual([['coding', 'scratch']]);
    const unreadable = scanSources([[scratch, 'useQuery({ queryKey: [prefix, id], queryFn });']]);
    expect(unreadable.errors).toHaveLength(1);
  });
});
