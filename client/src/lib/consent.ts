// The visitor's cookie choice (owner decision 2, 1 Oct 2026).
//
// Three categories:
//   necessary  sign-in, settings, progress kept in this browser, and this
//              choice itself. Always on; nothing optional runs under it.
//   analytics  PostHog product analytics (lib/analytics.ts).
//   marketing  Google Analytics 4 and the Meta Pixel (lib/marketing.ts). Not
//              connected yet: the switch exists so the tags can start the day
//              they are added, and only for visitors who said yes.
//
// Until the visitor decides, both optional categories are off, and so is
// anything that would store or send data for them. "Reject all" is one press,
// like "Accept all".
//
// The choice lives in localStorage (`devshark:consent`) with the version of
// the wording it answered and the time it was made. A copy goes into a
// first-party cookie (`devshark_consent`) so a server or edge function can
// read it later; nothing reads that copy today. Raise CONSENT_VERSION when
// the categories or what runs under them change (connecting GA4 or Meta is
// such a change): every browser is then asked again, and until it answers it
// counts as undecided. A choice older than twelve months is asked again too.
//
// A browser that refuses storage (a private mode, blocked site data) cannot
// keep a choice. It counts as not consented: the banner closes for this page,
// analytics and marketing stay off, and the next visit asks again.

import { useSyncExternalStore } from 'react';

/** Raise when the categories, their purposes or their providers change. */
export const CONSENT_VERSION = 1;
/** Asked again after this long. */
export const CONSENT_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
export const CONSENT_STORAGE_KEY = 'devshark:consent';
export const CONSENT_COOKIE = 'devshark_consent';

export type OptionalConsentCategory = 'analytics' | 'marketing';
export type ConsentCategory = 'necessary' | OptionalConsentCategory;
export const OPTIONAL_CATEGORIES: readonly OptionalConsentCategory[] = ['analytics', 'marketing'];

export type ConsentChoices = Record<OptionalConsentCategory, boolean>;

export interface ConsentRecord extends ConsentChoices {
  version: number;
  /** When the visitor chose, in epoch milliseconds. */
  decidedAt: number;
  /** False when the browser refused to store the choice: it holds for this
   * page only, and with every optional category off. */
  stored: boolean;
}

type Listener = (record: ConsentRecord | null) => void;

let current: ConsentRecord | null = null;
let loaded = false;
let listeningToOtherTabs = false;
let expiryTimer: number | undefined;
// Browsers clamp longer timeouts to a signed 32-bit integer.
const MAX_TIMEOUT_MS = 2_147_483_647;
const listeners = new Set<Listener>();

function isValid(value: unknown, now: number): value is Omit<ConsentRecord, 'stored'> {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<ConsentRecord>;
  return record.version === CONSENT_VERSION
    && typeof record.analytics === 'boolean'
    && typeof record.marketing === 'boolean'
    && typeof record.decidedAt === 'number'
    && Number.isFinite(record.decidedAt)
    // A clock set back a little is fine; a date far in the future is not a choice.
    && record.decidedAt <= now + 24 * 60 * 60 * 1000
    && now - record.decidedAt <= CONSENT_MAX_AGE_MS;
}

/** The stored choice for the current wording, or null: none, another
 * version, too old, unreadable, or storage refused. */
function readStored(now: number): ConsentRecord | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isValid(parsed, now)) return null;
    return { version: parsed.version, analytics: parsed.analytics, marketing: parsed.marketing, decidedAt: parsed.decidedAt, stored: true };
  } catch {
    return null;
  }
}

/** The cookie copy: `v=1&analytics=1&marketing=0&at=<epoch seconds>`. */
export function consentCookieValue(record: Pick<ConsentRecord, 'version' | 'analytics' | 'marketing' | 'decidedAt'>): string {
  return `v=${record.version}&analytics=${record.analytics ? 1 : 0}&marketing=${record.marketing ? 1 : 0}&at=${Math.floor(record.decidedAt / 1000)}`;
}

function writeCookie(record: ConsentRecord, now: number): void {
  try {
    const maxAge = Math.max(0, Math.floor((record.decidedAt + CONSENT_MAX_AGE_MS - now) / 1000));
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${CONSENT_COOKIE}=${consentCookieValue(record)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
  } catch {
    // The cookie is a copy for later server reads; localStorage is the record.
  }
}

/** Store a choice; false when the browser refused. A refused write must not
 * leave an earlier choice behind: a withdrawal the browser would not store
 * would otherwise come back as the old yes on the next visit. Removing needs
 * no space, so it works where a full storage refused the write. */
function persist(record: ConsentRecord, now: number): boolean {
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({
      version: record.version,
      analytics: record.analytics,
      marketing: record.marketing,
      decidedAt: record.decidedAt,
    }));
  } catch {
    try {
      window.localStorage.removeItem(CONSENT_STORAGE_KEY);
    } catch {
      // Storage refused altogether: it holds no earlier choice to come back.
    }
    try {
      document.cookie = `${CONSENT_COOKIE}=; Path=/; Max-Age=0`;
    } catch {
      // No cookie access: no copy to remove.
    }
    return false;
  }
  writeCookie(record, now);
  return true;
}

function scheduleExpiry(): void {
  window.clearTimeout(expiryTimer);
  expiryTimer = undefined;
  if (!current?.stored) return;
  const remaining = current.decidedAt + CONSENT_MAX_AGE_MS - Date.now() + 1;
  expiryTimer = window.setTimeout(refreshStoredChoice, Math.min(Math.max(remaining, 0), MAX_TIMEOUT_MS));
}

function refreshStoredChoice(): void {
  const next = readStored(Date.now());
  if (!sameChoice(current, next)) {
    current = next;
    emit();
  }
  scheduleExpiry();
}

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  if (typeof window === 'undefined') return;
  current = readStored(Date.now());
  scheduleExpiry();
  if (!listeningToOtherTabs) {
    listeningToOtherTabs = true;
    // A choice made in another tab applies here too.
    window.addEventListener('storage', (event) => {
      if (event.key !== null && event.key !== CONSENT_STORAGE_KEY) return;
      refreshStoredChoice();
    });
    window.addEventListener('pageshow', (event) => {
      if (event.persisted && current?.stored) refreshStoredChoice();
    });
  }
}

function sameChoice(a: ConsentRecord | null, b: ConsentRecord | null): boolean {
  if (a === null || b === null) return a === b;
  return a.analytics === b.analytics && a.marketing === b.marketing && a.decidedAt === b.decidedAt && a.stored === b.stored;
}

function emit(): void {
  for (const listener of [...listeners]) listener(current);
}

/** The visitor's choice for the current wording, or null while undecided. */
export function getConsent(): ConsentRecord | null {
  ensureLoaded();
  return current;
}

/** True when nothing valid is stored: the banner asks. */
export function needsConsentDecision(): boolean {
  return getConsent() === null;
}

/** Whether a category may run now. Necessary always may; the others only
 * after a yes for the current wording. */
export function hasConsent(category: ConsentCategory): boolean {
  if (category === 'necessary') return true;
  return getConsent()?.[category] === true;
}

/** Record a choice. A browser that refuses to store it gets the choice for
 * this page with every optional category off (not consented). */
export function saveConsent(choices: ConsentChoices, now: number = Date.now()): ConsentRecord {
  ensureLoaded();
  const wanted: ConsentRecord = {
    version: CONSENT_VERSION,
    analytics: choices.analytics === true,
    marketing: choices.marketing === true,
    decidedAt: now,
    stored: true,
  };
  const record = persist(wanted, now) ? wanted : { ...wanted, analytics: false, marketing: false, stored: false };
  current = record;
  scheduleExpiry();
  emit();
  return record;
}

export const acceptAllConsent = (): ConsentRecord => saveConsent({ analytics: true, marketing: true });
export const rejectAllConsent = (): ConsentRecord => saveConsent({ analytics: false, marketing: false });

/** Called with the new choice whenever it changes. Returns the unsubscribe. */
export function subscribeConsent(listener: Listener): () => void {
  ensureLoaded();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The current choice, re-rendering on change. */
export function useConsent(): ConsentRecord | null {
  return useSyncExternalStore(subscribeConsent, getConsent, () => null);
}

/* ── the settings dialog ───────────────────────────────────────────────── *
 * The banner's "Choose" and the footer's "Cookie settings" open one dialog,
 * which the shell mounts (ConsentHost). */

let settingsOpen = false;
const settingsListeners = new Set<() => void>();
const emitSettings = () => {
  for (const listener of [...settingsListeners]) listener();
};

export function openConsentSettings(): void {
  if (settingsOpen) return;
  settingsOpen = true;
  emitSettings();
}

export function closeConsentSettings(): void {
  if (!settingsOpen) return;
  settingsOpen = false;
  emitSettings();
}

function subscribeSettings(listener: () => void): () => void {
  settingsListeners.add(listener);
  return () => {
    settingsListeners.delete(listener);
  };
}

export function useConsentSettingsOpen(): boolean {
  return useSyncExternalStore(subscribeSettings, () => settingsOpen, () => false);
}

/** Tests only: forget the in-memory state so the next read starts fresh. */
export function resetConsentForTests(): void {
  window.clearTimeout(expiryTimer);
  expiryTimer = undefined;
  current = null;
  loaded = false;
  settingsOpen = false;
  listeners.clear();
  settingsListeners.clear();
}
