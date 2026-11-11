// The cookie choice (lib/consent.ts): nothing optional is allowed until the
// visitor decides, "Reject all" is as final as "Accept all", a new version of
// the wording asks again, and a browser that refuses storage counts as not
// consented.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_MS,
  CONSENT_STORAGE_KEY,
  CONSENT_VERSION,
  acceptAllConsent,
  getConsent,
  hasConsent,
  needsConsentDecision,
  rejectAllConsent,
  resetConsentForTests,
  saveConsent,
  subscribeConsent,
} from '../src/lib/consent';

const cookie = () => document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${CONSENT_COOKIE}=`)) ?? null;
const stored = () => JSON.parse(localStorage.getItem(CONSENT_STORAGE_KEY) ?? 'null') as Record<string, unknown> | null;
/** A fresh page load: the store reads the browser again. */
const reload = () => resetConsentForTests();

beforeEach(() => {
  localStorage.clear();
  document.cookie = `${CONSENT_COOKIE}=; Path=/; Max-Age=0`;
  reload();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('the consent store', () => {
  it('allows nothing optional until the visitor decides', () => {
    expect(getConsent()).toBeNull();
    expect(needsConsentDecision()).toBe(true);
    expect(hasConsent('necessary')).toBe(true);
    expect(hasConsent('analytics')).toBe(false);
    expect(hasConsent('marketing')).toBe(false);
    expect(cookie()).toBeNull();
  });

  it('records Accept all with the version and the time, in storage and in the cookie', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_790_000_000_000);
    const seen: unknown[] = [];
    subscribeConsent((record) => seen.push(record));
    const record = acceptAllConsent();
    expect(record).toMatchObject({ version: CONSENT_VERSION, analytics: true, marketing: true, decidedAt: 1_790_000_000_000, stored: true });
    expect(seen).toEqual([record]);
    expect(stored()).toEqual({ version: CONSENT_VERSION, analytics: true, marketing: true, decidedAt: 1_790_000_000_000 });
    expect(cookie()).toBe(`${CONSENT_COOKIE}=v=${CONSENT_VERSION}&analytics=1&marketing=1&at=1790000000`);
    expect(hasConsent('analytics')).toBe(true);
    expect(hasConsent('marketing')).toBe(true);
    reload();
    expect(getConsent()).toMatchObject({ analytics: true, marketing: true });
  });

  it('records Reject all as a decision with everything optional off', () => {
    const record = rejectAllConsent();
    expect(record).toMatchObject({ analytics: false, marketing: false, stored: true });
    expect(needsConsentDecision()).toBe(false);
    expect(hasConsent('analytics')).toBe(false);
    expect(cookie()).toContain('analytics=0&marketing=0');
    reload();
    expect(needsConsentDecision()).toBe(false);
  });

  it('records a mixed choice from Choose and lets the visitor change it later', () => {
    saveConsent({ analytics: true, marketing: false });
    expect(hasConsent('analytics')).toBe(true);
    expect(hasConsent('marketing')).toBe(false);
    const seen: unknown[] = [];
    subscribeConsent((record) => seen.push(record));
    saveConsent({ analytics: false, marketing: false });
    expect(hasConsent('analytics')).toBe(false);
    expect(seen).toHaveLength(1);
    reload();
    expect(getConsent()).toMatchObject({ analytics: false, marketing: false });
  });

  it('asks again when the wording has a new version', () => {
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ version: CONSENT_VERSION - 1, analytics: true, marketing: true, decidedAt: Date.now() }));
    reload();
    expect(getConsent()).toBeNull();
    expect(hasConsent('analytics')).toBe(false);
    // The same choice for the current version stands.
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ version: CONSENT_VERSION, analytics: true, marketing: false, decidedAt: Date.now() }));
    reload();
    expect(getConsent()).toMatchObject({ analytics: true, marketing: false });
  });

  it('asks again after twelve months', () => {
    const now = Date.now();
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ version: CONSENT_VERSION, analytics: true, marketing: true, decidedAt: now - CONSENT_MAX_AGE_MS - 1 }));
    reload();
    expect(getConsent()).toBeNull();
  });

  it('expires an existing choice in an open tab and notifies optional consumers', () => {
    vi.useFakeTimers();
    try {
      const now = Date.now();
      localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({
        version: CONSENT_VERSION, analytics: true, marketing: true, decidedAt: now - CONSENT_MAX_AGE_MS + 100,
      }));
      const listener = vi.fn();
      subscribeConsent(listener);
      expect(hasConsent('analytics')).toBe(true);

      vi.advanceTimersByTime(101);
      expect(listener).toHaveBeenCalledExactlyOnceWith(null);
      expect(needsConsentDecision()).toBe(true);
      expect(hasConsent('analytics')).toBe(false);
      expect(hasConsent('marketing')).toBe(false);
    } finally {
      reload();
      vi.useRealTimers();
    }
  });

  it('treats a damaged record as no decision', () => {
    localStorage.setItem(CONSENT_STORAGE_KEY, '{"version":1,"analytics":"yes"');
    reload();
    expect(getConsent()).toBeNull();
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ version: CONSENT_VERSION, analytics: 'yes', marketing: false, decidedAt: Date.now() }));
    reload();
    expect(getConsent()).toBeNull();
  });

  it('treats a browser that refuses to read storage as not consented', () => {
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ version: CONSENT_VERSION, analytics: true, marketing: true, decidedAt: Date.now() }));
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
    reload();
    expect(getConsent()).toBeNull();
    expect(hasConsent('analytics')).toBe(false);
    expect(hasConsent('marketing')).toBe(false);
  });

  it('treats a browser that refuses to store the choice as not consented, and asks again next time', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    const record = acceptAllConsent();
    // The banner can close for this page, but nothing optional may run.
    expect(record).toMatchObject({ analytics: false, marketing: false, stored: false });
    expect(needsConsentDecision()).toBe(false);
    expect(hasConsent('analytics')).toBe(false);
    expect(cookie()).toBeNull();
    reload();
    expect(needsConsentDecision()).toBe(true);
  });

  it('does not bring an earlier yes back when the browser refuses to store a withdrawal', () => {
    acceptAllConsent();
    expect(cookie()).toContain('analytics=1');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    const record = rejectAllConsent();
    expect(record).toMatchObject({ analytics: false, marketing: false, stored: false });
    expect(hasConsent('analytics')).toBe(false);
    // The next visit asks again; it never reads the old yes.
    reload();
    expect(getConsent()).toBeNull();
    expect(hasConsent('analytics')).toBe(false);
    expect(cookie()).toBeNull();
  });

  it('follows a choice made in another tab', () => {
    expect(getConsent()).toBeNull();
    const seen: unknown[] = [];
    subscribeConsent((record) => seen.push(record));
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ version: CONSENT_VERSION, analytics: true, marketing: false, decidedAt: Date.now() }));
    window.dispatchEvent(new StorageEvent('storage', { key: CONSENT_STORAGE_KEY }));
    expect(hasConsent('analytics')).toBe(true);
    expect(seen).toHaveLength(1);
  });
});
