// Exercise the retained FDE implementation as a future opt-in. Shipping
// defaults and the owner hold are covered in fde-visibility.test.tsx and
// the browser's fde-positioning.spec.ts.
vi.mock('../../shared/learn-section-ids', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../shared/learn-section-ids')>();
  return { ...original, FDE_SECTION_VISIBLE: true,
    isLearnSectionVisible: original.isLearnSectionId,
    VISIBLE_LEARN_SECTION_IDS: original.LEARN_SECTION_IDS };
});

import { planTopics } from '../../shared/progression';
import type { LearnerProfile } from '../../shared/learning-paths';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { apiFetch, friendlyError, isPremiumRequired } from '../src/lib/api';
import { closeUpgradeSheet, openUpgradeSheet, useUpgradeRequest } from '../src/lib/upgradeSheet';
import { isBarred, useLocks } from '../src/lib/locks';
import { buildToday } from '../src/lib/today';
import UpgradeSheet from '../src/components/UpgradeSheet';
import UpgradeSheetHost from '../src/components/UpgradeSheetHost';
import { server } from './mocks/server';
import { settingsHandler } from './mocks/handlers';

const auth = vi.hoisted(() => ({ value: { user: null as { id: string } | null, isAuthenticated: false, isLoading: false } }));
vi.mock('../src/lib/auth', () => ({ useAuth: () => auth.value }));

const signIn = () => { auth.value = { user: { id: 'user-1' }, isAuthenticated: true, isLoading: false }; };
const signOut = () => { auth.value = { user: null, isAuthenticated: false, isLoading: false }; };
afterEach(() => { signOut(); closeUpgradeSheet(); });

const FREE = { tier: 'free', source: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, inGrace: false, validUntil: null };
const PREMIUM = { ...FREE, tier: 'premium', source: 'manual' };
const plan = (body: unknown, status = 200) =>
  http.get('*/api/user/*', ({ request }) => new URL(request.url).searchParams.get('op') === 'entitlement'
    ? HttpResponse.json(body as never, { status })
    : undefined);

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={client}><MemoryRouter><LanguageProvider>{children}</LanguageProvider></MemoryRouter></QueryClientProvider>;
}

describe('the 402 contract in the API client', () => {
  it('opens the upgrade sheet once, in one place, and never shows a raw error', async () => {
    server.use(http.get('*/api/test', () => HttpResponse.json(
      { error: { code: 'premium_required', message: 'Premium opens this', kind: 'coding-task', ref: 'js-palindrome' } },
      { status: 402 },
    )));
    const sheet = renderHook(() => useUpgradeRequest());
    const error = await apiFetch('/api/test').catch((e: unknown) => e);
    expect(isPremiumRequired(error)).toBe(true);
    expect(friendlyError(error)).toMatch(/Premium opens this/);
    expect(sheet.result.current).toMatchObject({ kind: 'coding-task', ref: 'js-palindrome' });
  });
  it('leaves other refusals alone', async () => {
    server.use(http.get('*/api/test', () => HttpResponse.json({ error: { code: 'prerequisite_not_met' } }, { status: 403 })));
    const sheet = renderHook(() => useUpgradeRequest());
    await apiFetch('/api/test').catch(() => undefined);
    expect(sheet.result.current).toBeNull();
  });
});

describe('locks mirror the server', () => {
  const react13 = { kind: 'learn-level', topic: 'react', level: 13 } as const;
  const react12 = { kind: 'learn-level', topic: 'react', level: 12 } as const;
  const html = { kind: 'learn-level', topic: 'html', level: 6 } as const;

  it('locks Premium content for a signed-in free account and keeps the free tier open', async () => {
    signIn();
    server.use(plan(FREE));
    const { result } = renderHook(() => useLocks(), { wrapper });
    expect(result.current.loading).toBe(true);
    // No flash of locks: before the plan loads nothing reads as locked.
    expect(result.current.lockOf(react13)).toBe('unknown');
    await waitFor(() => expect(result.current.tier).toBe('free'));
    expect(result.current.lockOf(react13)).toBe('locked');
    expect(result.current.lockOf(react12)).toBe('open');
    expect(result.current.lockOf(html)).toBe('open');
    expect(result.current.lockOf({ kind: 'coding-task', taskId: 'js-digit-sum' })).toBe('open');
    expect(result.current.lockOf({ kind: 'coding-task', taskId: 'js-palindrome' })).toBe('locked');
  });
  it('opens everything for a Premium account', async () => {
    signIn();
    server.use(plan(PREMIUM));
    const { result } = renderHook(() => useLocks(), { wrapper });
    await waitFor(() => expect(result.current.tier).toBe('premium'));
    expect(result.current.lockOf(react13)).toBe('open');
    expect(result.current.lockOf({ kind: 'learning-path', pathId: 'fde' })).toBe('open');
  });
  it('bars a signed-out visitor from Premium content, as the server does, without a request', async () => {
    // The server answers a guest's Premium request with 402 (review finding
    // integrity-4), so the map draws it with the Premium mark.
    signOut();
    const { result } = renderHook(() => useLocks(), { wrapper });
    expect(result.current.tier).toBe('free');
    expect(result.current.lockOf(react13)).toBe('preview');
    expect(isBarred(result.current.lockOf(react13))).toBe(true);
    expect(isBarred(result.current.lockOf(react12))).toBe(false);
    expect(isBarred(result.current.lockOf({ kind: 'coding-task', taskId: 'js-digit-sum' }))).toBe(false);
  });
  it('reads as unknown, not locked, when the plan cannot load', async () => {
    signIn();
    server.use(plan({ error: { code: 'db_error' } }, 500));
    const { result } = renderHook(() => useLocks(), { wrapper });
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.lockOf(react13)).toBe('unknown');
    expect(isBarred(result.current.lockOf(react13))).toBe(false);
  });
});

describe('the Today plan', () => {
  it('keeps base-track work before a joined section and exposes one next action', () => {
    const profile: LearnerProfile = { schemaVersion: 2, baseTrack: 'frontend', specialization: null,
      sections: ['software-engineer'], goals: ['level-up'], experience: 'some', studyTime: '15-30', updatedAt: null };
    const topicOrder = planTopics(profile);
    const unfinished = { levels: { 1: { passed: false, bestPct: 0 } }, checkpoints: {} };
    const plan = buildToday({ javascript: unfinished, html: unfinished, dsa: unfinished }, 'webdev', {
      topicOrder, inPlan: topic => topicOrder.includes(topic), extraUnlocks: ['dsa'],
    });
    expect(plan.all.unfinished.map(item => item.topic)).toEqual(['html', 'javascript', 'dsa']);
    expect(plan.startHereId).toBe('html:1');
    expect(plan.items.filter(item => item.id === plan.startHereId)).toHaveLength(1);
  });
  it('stops offering a level Premium opens', () => {
    const open = buildToday({}, 'webdev');
    const first = open.all.new[0];
    expect(first).toBeDefined();
    const gated = buildToday({}, 'webdev', { canStart: (topic, level) => !(topic === first.topic && level === first.level) });
    expect(gated.all.new.some((item) => item.id === first.id)).toBe(false);
    expect(gated.all.new.length).toBe(open.all.new.length - 1);
  });
});

describe('the upgrade sheet', () => {
  // jsdom has no modal dialog; the sheet needs only the open state.
  const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
  proto.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  proto.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };

  it('says what Premium includes and what it costs, with VAT, and closes on Not now', async () => {
    server.use(settingsHandler);
    const sheet = renderHook(() => useUpgradeRequest());
    act(() => openUpgradeSheet({ kind: 'learn-level', ref: 'react:13' }));
    expect(sheet.result.current).toMatchObject({ kind: 'learn-level', ref: 'react:13' });
    render(<UpgradeSheet request={sheet.result.current!} />, { wrapper });
    expect(screen.getByText('This level is part of Premium.')).toBeInTheDocument();
    // The merchandise line waits for redemption to open (design audit P0.1).
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.queryByText(/redeem for devShark merchandise/)).not.toBeInTheDocument();
    expect(screen.getByText(/€4\.99 a month or €59\.88 a year, before VAT/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go Premium' })).toBeInTheDocument();
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Not now' })); });
    expect(sheet.result.current).toBeNull();
  });
  // UX audit money-11: the title alone in the header, the framing sentence as
  // body text above the list, and the list's kicker drawn by <Kicker>.
  it('reads title, what the free plan keeps, then what Premium adds', () => {
    server.use(settingsHandler);
    render(<UpgradeSheet request={{ id: 3, kind: 'learn-level', ref: 'react:13' }} />, { wrapper });
    const title = screen.getByRole('heading', { level: 2, name: 'Premium opens this' });
    const keeps = screen.getByText('Your free plan keeps HTML, CSS, JavaScript and React levels 1 to 12.');
    expect(title.closest('.astryx-layout-header')).not.toContainElement(keeps);
    const kicker = screen.getByRole('heading', { level: 3, name: 'Premium includes' });
    expect(kicker).toHaveClass('ss-kicker');
    expect([...kicker.classList].some((name) => /^ss-wave-v[1-8]$/.test(name))).toBe(true);
    // Document order: what you keep comes before what Premium adds.
    expect(keeps.compareDocumentPosition(kicker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelector('p.ss-kicker')).toBeNull();
  });
  // The sheet unmounts when it closes, which used to leave focus on <body>.
  it.each(['Escape', 'Not now'])('gives focus back to the lock that opened it after %s', async (how) => {
    server.use(settingsHandler);
    render(
      <>
        <button type="button" onClick={() => openUpgradeSheet({ kind: 'learn-level', ref: 'react:13' })}>Level 13 Premium</button>
        <UpgradeSheetHost />
      </>,
      { wrapper },
    );
    const lock = screen.getByRole('button', { name: 'Level 13 Premium' });
    lock.focus();
    fireEvent.click(lock);
    const later = await screen.findByRole('button', { name: 'Not now' });
    // A keyboard learner is inside the sheet by now.
    later.focus();
    if (how === 'Escape') fireEvent.keyDown(later, { key: 'Escape' });
    else fireEvent.click(later);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull());
    expect(document.activeElement).toBe(lock);
  });
  it('states the launch price with its note while the offer is on', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T08:00:00Z'));
    try {
      server.use(http.get('*/api/settings', () => HttpResponse.json({ billing: { enabled: true, cancellable: true, seller: 'link', launchOffer: true } })));
      render(<UpgradeSheet request={{ id: 2, kind: 'coding-task', ref: 'js-x' }} />, { wrapper });
      expect(await screen.findByRole('group', { name: 'Launch price €2.25 a month · €26.95 a year' })).toHaveTextContent('Offer ends 30 Nov 2026');
      expect(screen.getByText('€2.25 launch price; the regular price from 1 Dec 2026 is €4.99')).toBeInTheDocument();
      expect(screen.getByText('€26.95 launch price; the regular price from 1 Dec 2026 is €59.88')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
