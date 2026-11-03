// Quiz results the server graded but the account has not recorded yet.
//
// A graded quiz hands back a sealed receipt; POST /api/user/stats records it,
// once per attempt however often it is sent. When that write fails the
// receipt waits here and is sent again later (pendingQuizReplay.ts, which
// PendingQuizResults loads when the learner is signed in and has one waiting,
// and again when the browser comes back online). A receipt
// lives for an hour on the server: one it refuses as expired or invalid can
// never be recorded, so it is dropped rather than resent forever, and the
// caller says so. One entry per attempt, so a second failure does not
// overwrite the first.
import { ApiError } from './api';
import { readJSON, removeStored, writeJSON } from './storage';

const STORE_KEY = 'devshark:pending-quiz-receipts:v2';
/** The single slot used before results were kept per attempt. */
const LEGACY_KEY = 'studyshark:pending-quiz-receipt:v1';

export interface PendingReceipt {
  userId: string;
  receipt: string;
  profile: { email?: string; name?: string; picture?: string };
}

type Store = Record<string, PendingReceipt>;

const isPending = (value: unknown): value is PendingReceipt => {
  const v = value as Partial<PendingReceipt> | null;
  return !!v && typeof v.userId === 'string' && typeof v.receipt === 'string' && !!v.profile && typeof v.profile === 'object';
};

function readStore(): Store {
  const raw = readJSON<Record<string, unknown>>(STORE_KEY, {});
  const store: Store = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) if (isPending(value)) store[key] = value;
  }
  const legacy = readJSON<unknown>(LEGACY_KEY, null);
  if (isPending(legacy)) {
    store[`legacy:${legacy.receipt.slice(-22)}`] = legacy;
    writeJSON(STORE_KEY, store);
  }
  if (legacy !== null) removeStored(LEGACY_KEY);
  return store;
}

/** One key per attempt: a quiz session is one attempt, and its sealed token
 * ends in an authentication tag no other token shares. */
export const attemptKeyOf = (sessionId: string): string => sessionId.slice(-22);

export function queuePendingReceipt(attemptKey: string, pending: PendingReceipt): void {
  writeJSON(STORE_KEY, { ...readStore(), [attemptKey]: pending });
}

function dropPendingReceipt(attemptKey: string): void {
  const store = readStore();
  if (!(attemptKey in store)) return;
  delete store[attemptKey];
  if (Object.keys(store).length === 0) removeStored(STORE_KEY);
  else writeJSON(STORE_KEY, store);
}

export interface PendingReceiptResolution {
  attemptKey: string;
  userId: string;
  outcome: 'saved' | 'refused';
}

// The existing queue is also the source of truth for a result still on
// screen. Only a server-confirmed write or permanent refusal resolves it;
// disappearing local storage is never evidence that a result was saved.
const resolutionListeners = new Set<(resolution: PendingReceiptResolution) => void>();
export function onPendingReceiptResolution(listener: (resolution: PendingReceiptResolution) => void): () => void {
  resolutionListeners.add(listener);
  return () => { resolutionListeners.delete(listener); };
}

export function resolvePendingReceipt(attemptKey: string, userId: string, outcome: PendingReceiptResolution['outcome']): void {
  dropPendingReceipt(attemptKey);
  for (const listener of resolutionListeners) listener({ attemptKey, userId, outcome });
}

export function pendingReceiptsFor(userId: string): [string, PendingReceipt][] {
  return Object.entries(readStore()).filter(([, pending]) => pending.userId === userId);
}

/** The server will never record this receipt: it expired, or it is not this
 * account's. Resending it cannot help. */
export const isReceiptRefused = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 400 && error.code === 'invalid_receipt';
