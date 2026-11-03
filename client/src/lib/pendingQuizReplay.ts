// Sends the quiz results waiting in pendingQuizReceipts.ts again. It lives
// apart from the queue so the first page load does not carry it:
// PendingQuizResults loads it only when a signed-in learner has a result
// waiting, which is rare.
import { accountEpoch } from './accountData';
import { resolvePendingReceipt, isReceiptRefused, pendingReceiptsFor } from './pendingQuizReceipts';
import { recordQuizResult, type UserStats } from './supabase';

// The replay under way. Coming back online while one runs started a second
// that sent every waiting result again.
let replaying: { userId: string; run: Promise<{ recorded: number; refused: number }> } | null = null;

/** Send every waiting result of this learner again. Recorded ones and ones
 * the server refuses leave the queue; anything else (offline, a server
 * error) stays for the next try. A call while this learner's results are
 * already on their way waits for that replay and counts nothing itself. The
 * replay stops when the account signs out: the rest are no longer this
 * browser's to send, and a refusal then is no news for whoever is here. */
export function replayPendingReceipts(
  userId: string,
  onRecorded?: (data: UserStats | null) => void,
): Promise<{ recorded: number; refused: number }> {
  if (replaying?.userId === userId) return replaying.run.then(() => ({ recorded: 0, refused: 0 }));
  const run = sendPending(userId, onRecorded);
  const entry = { userId, run };
  replaying = entry;
  const done = () => { if (replaying === entry) replaying = null; };
  run.then(done, done);
  return run;
}

async function sendPending(
  userId: string,
  onRecorded?: (data: UserStats | null) => void,
): Promise<{ recorded: number; refused: number }> {
  const epoch = accountEpoch();
  let recorded = 0;
  let refused = 0;
  for (const [key, pending] of pendingReceiptsFor(userId)) {
    if (accountEpoch() !== epoch) break;
    try {
      const saved = await recordQuizResult(pending.receipt, pending.profile);
      if (accountEpoch() !== epoch) break;
      resolvePendingReceipt(key, userId, 'saved');
      recorded++;
      onRecorded?.(saved.data);
    } catch (error) {
      if (accountEpoch() !== epoch) break;
      if (isReceiptRefused(error)) {
        resolvePendingReceipt(key, userId, 'refused');
        refused++;
      }
    }
  }
  return { recorded, refused };
}
