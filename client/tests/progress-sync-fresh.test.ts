// How often the account's Learn progress is read (lib/roadmap.ts
// syncProgressWithServer). App's sign-in sync, Today and each Learn map asked
// within a second of each other, and every return to a map asked again: perf
// baseline #587 C08 and C22. A sync that answered in the last minute, for the
// same account, with no level completed since and the device copy as it left
// it, answers the next ask.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from './mocks/server';
import { completeRoadmapAttempt, PROGRESS_SYNC_FRESH_MS, syncProgressWithServer } from '../src/lib/roadmap';
import { clearAccountData } from '../src/lib/accountData';

const record = {
  data: { html: { levels: { 1: { passed: true, bestPct: 100 } }, checkpoints: {} } },
  extra: { unlocked: [] },
};

/** Every progress GET; `status` answers them with an error instead. */
function countProgressReads(status = 200) {
  const reads = { count: 0 };
  server.use(http.get('*/api/quiz/roadmap', ({ request }) => {
    expect(new URL(request.url).searchParams.get('resource')).toBe('progress');
    reads.count += 1;
    return status === 200 ? HttpResponse.json(record) : HttpResponse.json({ error: { code: 'upstream_timeout' } }, { status });
  }));
  return reads;
}

afterEach(() => {
  vi.useRealTimers();
  // Every test starts as a new account, so no window carries over.
  clearAccountData();
});

describe('the progress sync', () => {
  it('reads once for the sign-in sync, Today and the map, and once more after the window', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const reads = countProgressReads();
    await syncProgressWithServer();
    // Today, then the map, a beat later; then a return to the map.
    await syncProgressWithServer();
    vi.setSystemTime(Date.now() + 2_500);
    await syncProgressWithServer();
    expect(reads.count).toBe(1);
    vi.setSystemTime(Date.now() + PROGRESS_SYNC_FRESH_MS);
    await syncProgressWithServer();
    expect(reads.count).toBe(2);
  });

  it('merges the first successful progress response with its wallet and inventory', async () => {
    const balancesKey = 'devquiz:tokens:balance:v2';
    const inventoryKey = 'devquiz:shop:inventory:v2';
    server.use(http.get('*/api/quiz/roadmap', () => HttpResponse.json({
      ...record,
      extra: {
        ...record.extra,
        wallets: { webdev: { balance: 70 } },
        inventories: { webdev: { owned: ['ring-gold'], ring: 'ring-gold' } },
      },
    })));
    await syncProgressWithServer();
    expect(JSON.parse(localStorage.getItem(balancesKey) ?? '{}')).toEqual({ webdev: 70 });
    expect(JSON.parse(localStorage.getItem(inventoryKey) ?? '{}')).toEqual({
      webdev: { owned: ['ring-gold'], ring: 'ring-gold', flair: null, doubleXp: 0 },
    });
  });

  it('reads again after a level completion, which changed the record', async () => {
    const reads = countProgressReads();
    server.use(http.post('*/api/quiz/roadmap', () => HttpResponse.json({ correctAnswers: 8, totalQuestions: 8, percentage: 100, passed: true, applied: true, codingPending: [], progress: record.data })));
    await syncProgressWithServer();
    await completeRoadmapAttempt('session-1');
    await syncProgressWithServer();
    expect(reads.count).toBe(2);
  });

  it('reads again after a read that failed', async () => {
    const failed = countProgressReads(503);
    await syncProgressWithServer();
    expect(failed.count).toBe(1);
    const reads = countProgressReads();
    await syncProgressWithServer();
    expect(reads.count).toBe(1);
  });

  it('asks for the next account at once', async () => {
    const reads = countProgressReads();
    await syncProgressWithServer();
    clearAccountData();
    await syncProgressWithServer();
    expect(reads.count).toBe(2);
  });

  it('reads again when the device copy is no longer the one it wrote', async () => {
    const reads = countProgressReads();
    await syncProgressWithServer();
    localStorage.removeItem('devquiz:roadmap:v2');
    await syncProgressWithServer();
    expect(reads.count).toBe(2);
  });
});
