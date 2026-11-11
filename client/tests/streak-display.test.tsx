import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { StreakCard } from '../src/components/Profile';
import type { UserStats } from '../src/lib/supabase';
import { liveStreak, shieldRemaining, streakState, type StreakProtection } from '../src/lib/streakFreezes';
import { localDayChangeTime } from '../src/lib/utcDay';
import { server } from './mocks/server';

// The streak the Profile shows follows the server's rule on return to any
// verified learning (advance_verified_streak, migration 048): the two UTC
// dates a shield covers are paid for, every other missed day needs one of the
// month's protections, and more than two missed days end the streak.
const at = (iso: string) => Date.parse(iso);
const stats = (lastQuizDate: string, currentStreak = 12) => ({ current_streak: currentStreak, last_quiz_date: lastQuizDate });
const none = { remaining: 0, shieldUntil: null };

describe('liveStreak', () => {
  it('keeps the streak when the last quiz was today or yesterday', () => {
    expect(liveStreak(stats('2026-09-29'), none, at('2026-09-29T23:59:00Z'))).toBe(12);
    expect(liveStreak(stats('2026-09-28'), none, at('2026-09-29T00:01:00Z'))).toBe(12);
    // Before the protection state has loaded, the same two days count.
    expect(liveStreak(stats('2026-09-28'), null, at('2026-09-29T12:00:00Z'))).toBe(12);
  });

  it('ends it after a missed day nothing covers', () => {
    expect(liveStreak(stats('2026-09-27'), none, at('2026-09-29T12:00:00Z'))).toBe(0);
    expect(liveStreak(stats('2026-09-27'), null, at('2026-09-29T12:00:00Z'))).toBe(0);
  });

  it('keeps it two days on when a shield covers the missed day', () => {
    // Raised on the 27th at 20:00 the pre-048 way (stored as 48 hours on):
    // it covers the 27th and the 28th.
    const shield = { remaining: 0, shieldUntil: '2026-09-29T20:00:00Z' };
    expect(liveStreak(stats('2026-09-27'), shield, at('2026-09-29T12:00:00Z'))).toBe(12);
    // Raised on the 28th from 048 on: it ends at 00:00 UTC on the 30th.
    expect(liveStreak(stats('2026-09-27'), { remaining: 0, shieldUntil: '2026-09-30T00:00:00Z' }, at('2026-09-29T12:00:00Z'))).toBe(12);
  });

  it('covers exactly two dates: raised at 00:01 on Monday, Wednesday is not covered', () => {
    // Monday 2026-09-21 00:01, stored as 48 hours on: Wednesday 00:01.
    const shield = { remaining: 0, shieldUntil: '2026-09-23T00:01:00Z' };
    // Last learning day Sunday; back on Thursday: Wednesday was missed.
    expect(liveStreak(stats('2026-09-20'), shield, at('2026-09-24T09:00:00Z'))).toBe(0);
    expect(liveStreak(stats('2026-09-20'), { ...shield, remaining: 1 }, at('2026-09-24T09:00:00Z'))).toBe(12);
    // Back on Wednesday: Monday and Tuesday were the shield's.
    expect(liveStreak(stats('2026-09-20'), shield, at('2026-09-23T09:00:00Z'))).toBe(12);
    // Raised at 23:59 on Monday: still Monday and Tuesday only.
    expect(liveStreak(stats('2026-09-20'), { remaining: 0, shieldUntil: '2026-09-23T23:59:00Z' }, at('2026-09-24T09:00:00Z'))).toBe(0);
  });

  it('keeps it two days on when one protection is left for the missed day', () => {
    expect(liveStreak(stats('2026-09-27'), { remaining: 1, shieldUntil: null }, at('2026-09-29T12:00:00Z'))).toBe(12);
  });

  it('ends it when the gap is longer than the protections can bridge', () => {
    // Four days on, three days were missed: more than two ends it even with two left.
    expect(liveStreak(stats('2026-09-25'), { remaining: 2, shieldUntil: null }, at('2026-09-29T12:00:00Z'))).toBe(0);
    // Two missed days and one protection left.
    expect(liveStreak(stats('2026-09-26'), { remaining: 1, shieldUntil: null }, at('2026-09-29T12:00:00Z'))).toBe(0);
    expect(liveStreak(stats('2026-09-26'), { remaining: 2, shieldUntil: null }, at('2026-09-29T12:00:00Z'))).toBe(12);
  });

  it('spends a protection only on the days a shield does not cover', () => {
    // Raised on the 21st at 10:00: it covers the 21st and the 22nd; the 23rd
    // and the 24th need the two protections.
    const shield = { remaining: 2, shieldUntil: '2026-09-23T10:00:00Z' };
    expect(liveStreak(stats('2026-09-20'), shield, at('2026-09-25T08:00:00Z'))).toBe(12);
    expect(liveStreak(stats('2026-09-20'), { ...shield, remaining: 1 }, at('2026-09-25T08:00:00Z'))).toBe(0);
  });

  it('counts days across a month boundary in UTC', () => {
    // 31 August, then 2 September: 1 September was missed, and September's
    // budget is the one the server spends.
    expect(liveStreak(stats('2026-08-31'), { remaining: 2, shieldUntil: null }, at('2026-09-02T00:30:00Z'))).toBe(12);
    expect(liveStreak(stats('2026-08-30'), { remaining: 2, shieldUntil: null }, at('2026-09-02T23:30:00Z'))).toBe(12);
    expect(liveStreak(stats('2026-08-30'), { remaining: 1, shieldUntil: null }, at('2026-09-02T23:30:00Z'))).toBe(0);
    expect(liveStreak(stats('2026-08-31'), none, at('2026-09-01T00:00:00Z'))).toBe(12);
  });

  it('reads the last learning day whatever the learning was', () => {
    // last_quiz_date is the last UTC day with any verified learning (048).
    expect(liveStreak({ current_streak: 3, last_quiz_date: '2026-09-28' }, none, at('2026-09-29T08:00:00Z'))).toBe(3);
  });

  it('shows no streak without a recorded one', () => {
    expect(liveStreak(null, none, at('2026-09-29T12:00:00Z'))).toBe(0);
    expect(liveStreak({ current_streak: 0, last_quiz_date: '2026-09-29' }, none, at('2026-09-29T12:00:00Z'))).toBe(0);
    expect(liveStreak({ current_streak: 5, last_quiz_date: null }, none, at('2026-09-29T12:00:00Z'))).toBe(0);
  });

  it('keeps every shield’s days, not only the latest one’s (migration 052)', () => {
    // Learnt on the 27th and raised a shield (27th, 28th); still away on the
    // 29th, raised a second one with the last protection (29th, 30th). The
    // server keeps both in shieldDays; shieldUntil is only the second.
    const chained = { remaining: 0, shieldUntil: '2026-10-01T00:00:00Z', shieldDays: ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30'] };
    expect(liveStreak(stats('2026-09-27', 20), chained, at('2026-09-29T09:00:00Z'))).toBe(20);
    expect(liveStreak(stats('2026-09-27', 20), chained, at('2026-10-01T09:00:00Z'))).toBe(20);
    // Before 052 the second shield hid the first: the 28th read as missed.
    expect(liveStreak(stats('2026-09-27', 20), { remaining: 0, shieldUntil: '2026-10-01T00:00:00Z' }, at('2026-09-29T09:00:00Z'))).toBe(0);
    // A hole in the chain still needs a protection.
    const holed = { remaining: 0, shieldUntil: '2026-10-01T00:00:00Z', shieldDays: ['2026-09-27', '2026-09-29', '2026-09-30'] };
    expect(liveStreak(stats('2026-09-26', 20), holed, at('2026-10-01T09:00:00Z'))).toBe(0);
    expect(liveStreak(stats('2026-09-26', 20), { ...holed, remaining: 1 }, at('2026-10-01T09:00:00Z'))).toBe(20);
  });

  it('counts the missed days a protection still has to pay for', () => {
    expect(streakState(stats('2026-09-28'), none, at('2026-09-29T12:00:00Z'))).toEqual({ streak: 12, missed: 0 });
    expect(streakState(stats('2026-09-27'), { remaining: 1, shieldUntil: null }, at('2026-09-29T12:00:00Z'))).toEqual({ streak: 12, missed: 1 });
    expect(streakState(stats('2026-09-26'), { remaining: 2, shieldUntil: null, shieldDays: ['2026-09-27'] }, at('2026-09-29T12:00:00Z')))
      .toEqual({ streak: 12, missed: 1 });
    expect(streakState(stats('2026-09-20'), { remaining: 2, shieldUntil: null }, at('2026-09-29T12:00:00Z')).streak).toBe(0);
  });
});

describe('shieldRemaining', () => {
  it('counts down to the end of the day after the raise date (UTC)', () => {
    // Raised on the 29th from 048 on: stored as 00:00 UTC on 1 October.
    expect(shieldRemaining('2026-10-01T00:00:00Z', at('2026-09-29T22:30:00Z'))).toEqual({ hours: 25, minutes: 30 });
    expect(shieldRemaining('2026-10-01T00:00:00Z', at('2026-10-01T00:00:00Z'))).toBeNull();
  });

  it('stops a pre-048 shield where its cover ends, not 48 hours after it was raised', () => {
    // Raised on the 27th at 20:00 and stored as the 29th at 20:00: it covers the
    // 27th and the 28th, so nothing is left on the 29th.
    expect(shieldRemaining('2026-09-29T20:00:00Z', at('2026-09-28T23:00:00Z'))).toEqual({ hours: 1, minutes: 0 });
    expect(shieldRemaining('2026-09-29T20:00:00Z', at('2026-09-29T12:00:00Z'))).toBeNull();
  });
});

// The Profile's streak card, reading the protection state the server returns.
const utcDate = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
const utcMidnight = (daysAgo: number) => `${utcDate(daysAgo)}T00:00:00.000Z`;
const account = (streak: number, lastQuizDaysAgo: number | null): UserStats => ({
  id: 'stats-1', user_id: 'user-1', email: null, name: null, picture: null,
  total_quizzes: 20, total_correct: 150, total_questions: 200,
  current_streak: streak, longest_streak: Math.max(streak, 20),
  last_quiz_date: lastQuizDaysAgo === null ? null : utcDate(lastQuizDaysAgo),
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
});
const protectionIs = (state: Partial<StreakProtection>) =>
  server.use(http.get('*/api/user/freezes', () => HttpResponse.json({
    remaining: 2, period: new Date().toISOString().slice(0, 7), used: [], shieldUntil: null, shieldDays: [], shieldSupported: true, ...state,
  })));
const currentStreak = () => within(screen.getByRole('group', { name: 'Current streak' }));
// The shield sits under the two tiles in a group of its own (social-account-17).
const protection = async () => within(await screen.findByRole('group', { name: 'Streak protection' }));

describe('the Profile streak card', () => {
  // Until migration 052 this card offered the shield here, and pressing it
  // spent the one protection yesterday needed: the streak ended the moment
  // the learner came back (review finding RANK-2).
  it('keeps the count a protection still covers, and says to learn today rather than spend that protection', async () => {
    protectionIs({ remaining: 1 });
    render(<LanguageProvider><StreakCard stats={account(12, 2)} /></LanguageProvider>);
    expect((await protection()).getByText('Learn today to keep your streak')).toBeVisible();
    expect(currentStreak().getByText('12')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Protect today and tomorrow' })).toBeNull();
  });

  it('does not offer a shield that two missed days would need both protections for', async () => {
    protectionIs({ remaining: 2 });
    render(<LanguageProvider><StreakCard stats={account(12, 3)} /></LanguageProvider>);
    expect((await protection()).getByText('Learn today to keep your streak')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Protect today and tomorrow' })).toBeNull();
  });

  it('offers the shield when a protection is spare after the missed day', async () => {
    protectionIs({ remaining: 2 });
    render(<LanguageProvider><StreakCard stats={account(12, 2)} /></LanguageProvider>);
    const shield = (await protection()).getByRole('button', { name: 'Protect today and tomorrow' });
    expect(shield).toBeVisible();
    expect(currentStreak().getByText('12')).toBeVisible();
    // Under the pair, not inside the current tile, so the tiles share a height.
    expect(currentStreak().queryByRole('button')).toBeNull();
    expect(shield.closest('[role="group"][aria-label="Streak protection"]')!.parentElement)
      .toBe(screen.getByRole('group', { name: 'Longest streak' }).parentElement!.parentElement);
  });

  it('says what the server says when it refuses the shield', async () => {
    protectionIs({ remaining: 1 });
    server.use(http.post('*/api/user/freezes', () => HttpResponse.json(
      { error: { code: 'shield_would_end_streak', message: 'Learn today to keep your streak' } }, { status: 409 },
    )));
    render(<LanguageProvider><StreakCard stats={account(12, 1)} /></LanguageProvider>);
    fireEvent.click((await protection()).getByRole('button', { name: 'Protect today and tomorrow' }));
    expect(await (await protection()).findByRole('alert')).toHaveTextContent('Learn today to keep your streak');
  });

  it('stops showing an expired protection on an open Profile', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.setSystemTime(new Date('2026-10-23T23:58:00Z'));
      protectionIs({ remaining: 0, shieldUntil: '2026-10-24T00:00:00Z' });
      render(<LanguageProvider><StreakCard stats={account(12, 0)} /></LanguageProvider>);
      expect((await protection()).getByText(/^Protected/)).toBeVisible();
      await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
      expect((await protection()).getByText('No protection left this month')).toBeVisible();
      expect(screen.queryByText(/^Protected/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a streak two shields in a row cover', async () => {
    protectionIs({ remaining: 0, shieldUntil: utcMidnight(0), shieldDays: [utcDate(4), utcDate(3), utcDate(2), utcDate(1)] });
    render(<LanguageProvider><StreakCard stats={account(12, 4)} /></LanguageProvider>);
    expect((await protection()).getByText('No protection left this month')).toBeVisible();
    expect(currentStreak().getByText('12')).toBeVisible();
  });

  it('shows the streak as unknown when the protection read fails and the gap depends on it', async () => {
    let asked = 0;
    server.use(http.get('*/api/user/freezes', () => {
      asked += 1;
      return HttpResponse.json({ error: { code: 'db_error', message: 'Could not load streak protection' } }, { status: 500 });
    }));
    render(<LanguageProvider><StreakCard stats={account(12, 2)} /></LanguageProvider>);
    await vi.waitFor(() => expect(asked).toBe(1));
    expect(await currentStreak().findByLabelText('Unavailable')).toHaveTextContent('—');
    expect(currentStreak().queryByText('0')).toBeNull();
  });

  it('still shows a streak whose last day was yesterday when the protection read fails', async () => {
    let asked = 0;
    server.use(http.get('*/api/user/freezes', () => {
      asked += 1;
      return HttpResponse.json({ error: { code: 'db_error', message: 'Could not load streak protection' } }, { status: 500 });
    }));
    render(<LanguageProvider><StreakCard stats={account(12, 1)} /></LanguageProvider>);
    await vi.waitFor(() => expect(asked).toBe(1));
    expect(currentStreak().getByText('12')).toBeVisible();
    expect(currentStreak().queryByLabelText('Unavailable')).toBeNull();
  });

  it('shows 0 once nothing covers the gap, and offers no shield', async () => {
    protectionIs({ remaining: 0 });
    render(<LanguageProvider><StreakCard stats={account(12, 3)} /></LanguageProvider>);
    expect((await protection()).getByText('No protection left this month')).toBeVisible();
    expect(currentStreak().getByText('0')).toBeVisible();
  });

  it('does not offer a brand-new account a shield it has nothing to protect with', async () => {
    let asked = 0;
    server.use(http.get('*/api/user/freezes', () => {
      asked += 1;
      return HttpResponse.json({ remaining: 2, period: '2026-09', used: [], shieldUntil: null, shieldDays: [], shieldSupported: true });
    }));
    render(<LanguageProvider><StreakCard stats={account(0, null)} /></LanguageProvider>);
    await vi.waitFor(() => expect(asked).toBe(1));
    expect(currentStreak().getByText('0')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Protect today and tomorrow' })).toBeNull();
  });

  it('says what makes a streak day and when a day ends on the learner’s clock', async () => {
    protectionIs({ remaining: 2 });
    render(<LanguageProvider><StreakCard stats={account(4, 0)} /></LanguageProvider>);
    expect(await screen.findByText('A day counts when you finish a quiz, a Learn level or a Challenge run, or pass a coding task.')).toBeVisible();
    expect(screen.getByText(`Days change at ${localDayChangeTime()} your time.`)).toBeVisible();
  });

  it('still shows a shield that is already running', async () => {
    protectionIs({ remaining: 1, shieldUntil: new Date(Date.now() + 30 * 3_600_000).toISOString() });
    render(<LanguageProvider><StreakCard stats={account(0, null)} /></LanguageProvider>);
    expect((await protection()).getByText(/^Protected · \d+ h \d+ m left$/)).toBeVisible();
  });
});
