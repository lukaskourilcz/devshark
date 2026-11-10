// What a signed-in account leaves in this browser, and forgetting it.
//
// Learn progress and unlocks, the chosen track, quest XP and rank marks, the
// coin and shop snapshots the account sync carries, bookmarks, the perfect-quiz
// count, coding drafts, the typing best, results waiting to be recorded, the
// cached leaderboards, an invitation or voucher code and the legacy admin
// password all sit in localStorage or sessionStorage under the app's prefixes.
// After a sign-out or an account deletion the next person on the device must
// not see them, and must not have them merged into their own account when they
// sign in (lib/roadmap.ts unions unlocks and keeps the larger coin snapshot).
//
// Everything under those prefixes goes except the device's own settings below:
// they belong to the device or the person at it, not to an account, and a
// sign-in in progress needs its return path. A key added later is cleared
// unless it is listed here.
//
// Coding drafts are the one exception, and only when the sign-out was not the
// learner's choice: a session that could not refresh (expired, revoked, the
// password changed elsewhere) keeps them, under the account's id, out of
// sight. When that account signs in again they come back as the device copies
// they were, and the usual rules of coding/drafts.ts decide what opens; when
// another account signs in they are deleted unread (owner decision 4).
// Learning-path drafts kept on this device (lib/learningPathWorkspace.ts) go
// the same way: kept for that account alone, back in place as soon as it signs
// in again, deleted unread for any other.

import { emitAllStores } from './store';
import { readJSON, removeStored, writeJSON } from './storage';

const APP_PREFIXES = ['devquiz:', 'devshark:', 'studyshark:', 'shark:'];

const DEVICE_KEYS = new Set([
  'devquiz:color-mode', // appearance
  'devquiz:settings', // sound effects
  'devquiz:quiz-setup:v1', // quiz length, difficulty and topics
  'devshark:coding:layout:v1', // editor layout
  'devquiz:register-prompt:dismissed:v1', // this tab's "Not now"
  'devshark:campaign', // the campaign this browser first arrived with
  'devshark:auth-return', // a sign-in's way back (lib/authReturn.ts)
  'devshark:auth-resume',
  'devshark:upgrade-resume',
  'devshark:route-reload',
  'devshark:signed-out-by-choice', // a Log out, which the other tabs hear too (lib/auth.tsx)
]);
// A `devquiz.lang` value left by an older build sits outside the prefixes and is kept.

/** A learning preference chosen before any sign-in (lib/trackPref.ts). */
const GUEST_PREFERENCE = /^devquiz:[^:]+:learning-preference:guest$/;

const isAccountKey = (key: string): boolean =>
  APP_PREFIXES.some((prefix) => key.startsWith(prefix)) && !DEVICE_KEYS.has(key) && !GUEST_PREFERENCE.test(key);

function clear(storage: Storage): void {
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
  for (const key of keys) if (key && isAccountKey(key)) storage.removeItem(key);
}

// Which account's data this page holds: a count that moves every time the
// data is forgotten. Work started for one account (a progress sync still in
// flight at sign-out) reads it before and after, and writes nothing when it
// moved, so the account that left does not come back into the browser.
let epoch = 0;

/** The current account epoch; see above. */
export function accountEpoch(): number {
  return epoch;
}

// Work still in memory when the account changes: a draft typed a moment ago
// that waits to be written. It reaches storage before the data is forgotten,
// kept or taken back.
const settlers = new Set<() => void>();
/** Run `settle` before the account's data is forgotten or kept. Returns the
 * way to stop, for work that lives only while a view does. */
export function beforeAccountChange(settle: () => void): () => void {
  settlers.add(settle);
  return () => { settlers.delete(settle); };
}
const settle = () => settlers.forEach((one) => {
  try { one(); } catch { /* A failed draft flush must never prevent the account wipe. */ }
});

// A device copy, its time and a copy set aside, per task (coding/drafts.ts),
// and where an involuntary sign-out keeps them: the account's id and the
// keys as they were. coding/drafts.ts gives them back when that account
// opens a coding task signed in again.
export const DRAFT_KEY = /^devshark:coding:draft(-time|-aside)?:(.+)$/;
export const KEPT_DRAFTS = 'devshark:coding:kept:v1';
interface Kept { userId: string; drafts: Record<string, string> }
export const keptDrafts = (): Kept | null => {
  const value = readJSON<Kept | null>(KEPT_DRAFTS, null);
  return typeof value?.userId === 'string' && value.drafts && typeof value.drafts === 'object' ? value : null;
};

// The device copies of unsaved learning-path drafts, per enrollment and
// activity, and where an involuntary sign-out keeps them. Their keys name the
// account's own enrollment, so they need no merging on the way back.
export const PATH_DRAFT_KEY = /^devshark:path:draft:/;
export const KEPT_PATH_DRAFTS = 'devshark:path:kept:v1';
const keptPathDrafts = (): Kept | null => {
  const value = readJSON<Kept | null>(KEPT_PATH_DRAFTS, null);
  return typeof value?.userId === 'string' && value.drafts && typeof value.drafts === 'object' ? value : null;
};

/** What `held` keeps for `userId` (another tab may have kept some already)
 * with the keys `pattern` matches on this device now. */
function collectKept(userId: string, held: Kept | null, pattern: RegExp): Record<string, string> {
  const drafts: Record<string, string> = held?.userId === userId ? { ...held.drafts } : {};
  try {
    for (const key of Object.keys(localStorage)) if (pattern.test(key)) drafts[key] = localStorage.getItem(key) ?? '';
  } catch { /* storage may be disabled */ }
  return drafts;
}

/** Forget the account's data on this device and refresh what shows it. With
 * `keepDraftsOf`, a sign-out the learner did not choose: that account's coding
 * and learning-path drafts are kept for it. Says whether drafts are kept for
 * it now. */
export function clearAccountData(keepDraftsOf: string | null = null): boolean {
  settle();
  epoch += 1;
  const drafts = keepDraftsOf ? collectKept(keepDraftsOf, keptDrafts(), DRAFT_KEY) : {};
  const pathDrafts = keepDraftsOf ? collectKept(keepDraftsOf, keptPathDrafts(), PATH_DRAFT_KEY) : {};
  try { clear(localStorage); } catch { /* storage may be disabled */ }
  try { clear(sessionStorage); } catch { /* storage may be disabled */ }
  const keepingCode = Object.keys(drafts).length > 0;
  const keepingPaths = Object.keys(pathDrafts).length > 0;
  if (keepDraftsOf && keepingCode) writeJSON(KEPT_DRAFTS, { userId: keepDraftsOf, drafts } satisfies Kept);
  if (keepDraftsOf && keepingPaths) writeJSON(KEPT_PATH_DRAFTS, { userId: keepDraftsOf, drafts: pathDrafts } satisfies Kept);
  emitAllStores();
  return Boolean(keepDraftsOf) && (keepingCode || keepingPaths);
}

/** An account signed in: drafts kept for an account before it are deleted
 * unread, and its own learning-path drafts go back in place. Its own coding
 * drafts wait for it to open a coding task (coding/drafts.ts). */
export function forgetOthersKeptDrafts(userId: string): void {
  let changed = false;
  const paths = keptPathDrafts();
  if (paths) {
    changed = true;
    removeStored(KEPT_PATH_DRAFTS);
    if (paths.userId === userId) {
      try {
        // A copy written here since is newer than the one kept. Storage that
        // was changed by hand can hold anything; only text was ever kept.
        for (const [key, value] of Object.entries(paths.drafts)) {
          if (typeof value === 'string' && PATH_DRAFT_KEY.test(key) && localStorage.getItem(key) === null) localStorage.setItem(key, value);
        }
      } catch { /* storage may be disabled */ }
    }
  }
  if ((keptDrafts()?.userId ?? userId) !== userId) {
    changed = true;
    removeStored(KEPT_DRAFTS);
  }
  if (changed) emitAllStores();
}
