// PostHog product analytics - explicit funnels and event capture.
//
// Mirrors the Sentry wiring (lib/sentry.ts): everything here is a no-op until
// VITE_PUBLIC_POSTHOG_KEY is set, so local/preview builds and forks with no key
// pay nothing. Unlike Sentry, the SDK is pulled in with a *dynamic* import so
// posthog-js lands in its own lazy chunk and never touches the initial bundle.
//
// Consent (lib/consent.ts): PostHog runs only after the visitor says yes to
// analytics. Before that the SDK is not downloaded, nothing is stored and
// nothing is sent; the current path and the signed-in id wait in memory so
// the pageview and the identity can follow a yes on the same page. A no, or a
// later withdrawal, resets PostHog, opts it out and removes every `ph_` /
// `__ph_` cookie and storage key and the stored campaign, including ones an
// older build wrote before the banner existed.
//
// Privacy / GDPR: we point at PostHog EU Cloud and reverse-proxy every request
// through our own /ingest path (see vercel.json). That keeps the CSP tight to
// 'self' (no third-party host) and stops ad-blockers from dropping events.
// `person_profiles: 'identified_only'` means anonymous visitors don't create
// person profiles, and `respect_dnt` honours Do-Not-Track and Global Privacy
// Control.

import type { PostHog } from 'posthog-js';
import { readJSON, removeStored, writeJSON } from './storage';
import { hasConsent, subscribeConsent } from './consent';

/* ── campaign attribution (#239) ───────────────────────────────────────── *
 * Social posts link to devShark with `utm_source`, `utm_medium` and
 * `utm_campaign` (instagram|threads|linkedin, post|story|bio|reply|ad, a
 * kebab-case campaign). The first pageview keeps those three and nothing else
 * of the query string, and the first campaign a browser arrived with becomes
 * the person's initial campaign when the visitor signs in. Every other query
 * parameter (`ref`, `voucher`, a Stripe `session_id`, anything a mail client
 * appended) is dropped from every URL analytics sees, and a value that is not
 * a short campaign label (an e-mail address, a token) is dropped as well. */

export const CAMPAIGN_KEYS = ['utm_source', 'utm_medium', 'utm_campaign'] as const;
export type CampaignKey = (typeof CAMPAIGN_KEYS)[number];
export type Campaign = Partial<Record<CampaignKey, string>>;

const CAMPAIGN_STORAGE_KEY = 'devshark:campaign';
/** A first touch older than this no longer explains a sign-up. */
const CAMPAIGN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const CAMPAIGN_VALUE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** A short campaign label, normalized the same way in URLs and event fields. */
export function campaignLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const label = value.trim().toLowerCase();
  return CAMPAIGN_VALUE.test(label) ? label : undefined;
}

/** The campaign labels in a query string, lower-cased; anything else is left out. */
export function campaignFrom(search: string): Campaign {
  const params = new URLSearchParams(search);
  const campaign: Campaign = {};
  for (const key of CAMPAIGN_KEYS) {
    const value = campaignLabel(params.get(key));
    if (value) campaign[key] = value;
  }
  return campaign;
}

const campaignQuery = (campaign: Campaign): string => {
  const params = new URLSearchParams();
  for (const key of CAMPAIGN_KEYS) if (campaign[key]) params.set(key, campaign[key]!);
  const query = params.toString();
  return query ? `?${query}` : '';
};

/** A URL as analytics may see it: origin and path, plus the campaign labels
 * when `keepCampaign` is set. No other parameter and no fragment. */
export function scrubUrl(href: string, keepCampaign = false): string {
  try {
    const url = new URL(href);
    return `${url.origin}${url.pathname}${keepCampaign ? campaignQuery(campaignFrom(url.search)) : ''}`;
  } catch {
    return '';
  }
}

interface StoredCampaign {
  campaign: Campaign;
  savedAt: number;
}

/** The campaign of this page load, and the browser's first one (kept 30 days). */
let arrivalCampaign: Campaign = {};

/** Keep this page load's campaign as the browser's first one, unless a
 * recent one is already kept. Only with analytics consent: before it, the
 * campaign stays in memory and nothing is written. */
function keepFirstTouch(now: number): void {
  if (Object.keys(arrivalCampaign).length === 0 || !hasConsent('analytics')) return;
  const kept = readJSON<StoredCampaign | null>(CAMPAIGN_STORAGE_KEY, null);
  if (!kept || typeof kept.savedAt !== 'number' || now - kept.savedAt > CAMPAIGN_MAX_AGE_MS) {
    writeJSON(CAMPAIGN_STORAGE_KEY, { campaign: arrivalCampaign, savedAt: now } satisfies StoredCampaign);
  }
}

/** Read the campaign from the address the visitor arrived at. Runs once, at
 * start-up, before anything takes a parameter out of the address bar. The
 * first campaign a browser saw wins; a later one does not replace it. It is
 * stored only once the visitor has said yes to analytics. */
export function captureCampaignFromUrl(search: string = window.location.search, now: number = Date.now()): Campaign {
  arrivalCampaign = campaignFrom(search);
  keepFirstTouch(now);
  return arrivalCampaign;
}

/** The browser's first campaign, if it is recent enough to explain a sign-up. */
export function firstTouchCampaign(now: number = Date.now()): Campaign {
  if (!hasConsent('analytics')) return {};
  const kept = readJSON<StoredCampaign | null>(CAMPAIGN_STORAGE_KEY, null);
  if (!kept || typeof kept.savedAt !== 'number' || now - kept.savedAt > CAMPAIGN_MAX_AGE_MS || !kept.campaign) return {};
  // Stored by an older build or edited by hand: checked again like a URL.
  return campaignFrom(campaignQuery(kept.campaign as Campaign));
}

/* ── consent gate ──────────────────────────────────────────────────────── */

/** The cookie and storage names PostHog writes: `ph_<key>_posthog` (cookie
 * and localStorage), `__ph_opt_in_out_<key>` (its own consent flag), and
 * `ph_<key>_window_id` and friends in sessionStorage. Matched by prefix, so
 * a key from an older build goes too. */
const POSTHOG_KEY = /^(?:__)?ph_/;

let started = false;
/** The visitor said yes to analytics and has not withdrawn it. */
let active = false;
// A later yes cannot revive work queued under a withdrawn choice.
let consentGeneration = 0;
let sdk: Promise<{ startPostHog: (key: string, apiHost: string) => PostHog } | null> | null = null;
/** The client, once `init` has run. posthog-js is a singleton: it is
 * initialised once per page and opted in and out after that. */
let client: PostHog | null = null;
/** PostHog has been opted in for the current yes. */
let optedIn = false;
/** The page the visitor is on, and whether its pageview went out. */
let currentPath: string | null = null;
let viewSent = false;
let firstPageview = true;
/** The signed-in learner, kept in memory until analytics may run. */
let identity: { id: string; properties?: Record<string, unknown> } | null = null;
/** The id PostHog was last told about under the current yes. Auth hands the
 * same learner over again on every token refresh; telling PostHog again
 * would send the campaign as a fresh `$set` each time. */
let identifiedId: string | null = null;

const posthogKey = () => import.meta.env.VITE_PUBLIC_POSTHOG_KEY as string | undefined;

/** Every Domain a cookie for this page can carry: none (this host only),
 * the host, and each parent. PostHog's cross-subdomain cookie lives on the
 * site's registrable domain and goes only with that Domain attribute; a
 * browser ignores the ones it would never have accepted. */
function cookieDomains(): (string | null)[] {
  const parts = window.location.hostname.split('.');
  const domains: (string | null)[] = [null];
  for (let i = 0; i < parts.length - 1; i++) domains.push(parts.slice(i).join('.'));
  return domains;
}

/** Remove what PostHog and the campaign attribution keep in this browser. */
export function clearAnalyticsStorage(): void {
  for (const store of ['localStorage', 'sessionStorage'] as const) {
    try {
      const storage = window[store];
      const keys: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key && POSTHOG_KEY.test(key)) keys.push(key);
      }
      for (const key of keys) storage.removeItem(key);
    } catch {
      // Storage refused: PostHog could not have kept anything there either.
    }
  }
  removeStored(CAMPAIGN_STORAGE_KEY);
  try {
    const names = document.cookie
      .split(';')
      .map((part) => part.split('=')[0].trim())
      .filter((name) => POSTHOG_KEY.test(name));
    for (const name of names) {
      for (const domain of cookieDomains()) {
        document.cookie = `${name}=; Path=/; Max-Age=0${domain ? `; Domain=${domain}` : ''}`;
      }
    }
  } catch {
    // No cookie access: nothing to remove.
  }
}

/** The initialised client, or null while analytics may not run. The first
 * call after a yes loads the SDK, initialises it and opts it in. */
function ready(): Promise<PostHog | null> {
  const key = posthogKey();
  if (!active || !key) return Promise.resolve(null);
  const generation = consentGeneration;
  sdk ??= import('./posthogClient').catch(() => {
    sdk = null;
    return null;
  });
  return sdk.then((module) => {
    // Withdrawn while the SDK was on its way: it is never initialised.
    if (!module || !active || consentGeneration !== generation) return null;
    // Default to the same-origin reverse proxy; override only if you must.
    client ??= module.startPostHog(key, (import.meta.env.VITE_PUBLIC_POSTHOG_HOST as string | undefined) || '/ingest');
    const ph = client;
    if (!optedIn) {
      ph.opt_in_capturing({ captureEventName: false });
      optedIn = true;
    }
    return ph;
  });
}

function withActiveClient(run: (ph: PostHog) => void): void {
  const generation = consentGeneration;
  void ready().then((ph) => {
    if (ph && active && consentGeneration === generation) run(ph);
  });
}

function sendPageview(path: string): void {
  viewSent = true;
  withActiveClient((ph) => {
    const campaign = firstPageview ? arrivalCampaign : {};
    firstPageview = false;
    ph.capture('$pageview', { $current_url: window.location.origin + path + campaignQuery(campaign), ...campaign });
  });
}

function sendIdentity(id: string, properties?: Record<string, unknown>): void {
  identifiedId = id;
  const campaign = firstTouchCampaign();
  withActiveClient((ph) => ph.identify(id, properties, Object.keys(campaign).length > 0 ? campaign : undefined));
}

/** A yes: load PostHog, then send the pageview of the page the visitor is on
 * and the signed-in identity, which waited in memory. */
function start(): void {
  if (active) return;
  active = true;
  keepFirstTouch(Date.now());
  if (!posthogKey()) return;
  void ready();
  if (currentPath !== null && !viewSent) sendPageview(currentPath);
  if (identity) sendIdentity(identity.id, identity.properties);
}

/** A no, or a withdrawal: PostHog stops, forgets the visitor and loses
 * everything it kept in this browser. reset() comes first because it also
 * clears PostHog's consent flag; opting out after it leaves PostHog out. */
function stop(): void {
  const wasRunning = client !== null && optedIn;
  consentGeneration += 1;
  active = false;
  optedIn = false;
  viewSent = false;
  identifiedId = null;
  if (wasRunning && client) {
    client.reset();
    client.opt_out_capturing();
  }
  clearAnalyticsStorage();
}

/** Start analytics under the visitor's consent and follow every change of
 * it. Runs once, at start-up. Without a key PostHog never loads, but a
 * browser without consent still loses what an older build stored, from the
 * time PostHog ran for every visitor. */
export function initAnalytics(): void {
  if (started) return;
  started = true;
  captureCampaignFromUrl();
  if (hasConsent('analytics')) start();
  else stop();
  subscribeConsent((record) => {
    if (record?.analytics === true) start();
    else stop();
  });
}

/** Capture a product event (no-op unless analytics may run). */
export function capture(event: string, properties?: Record<string, unknown>): void {
  if (!active) return;
  withActiveClient((ph) => ph.capture(event, properties));
}

/** Record a SPA pageview on route change. The first one of a page load keeps
 * the campaign labels it arrived with, in the URL and as properties, so a
 * click from a social post is attributed; later ones carry the path alone.
 * Before consent only the path is kept, in memory, so a yes on this page
 * sends its pageview then. */
export function capturePageview(path: string): void {
  currentPath = path;
  viewSent = false;
  if (active) sendPageview(path);
}

/** Tie subsequent events to a signed-in user (call on auth). The browser's
 * first campaign becomes the person's initial one: set once, never replaced.
 * Before consent the id waits in memory and is sent after a yes. */
export function identifyUser(id: string, properties?: Record<string, unknown>): void {
  const again = identity?.id === id && properties === undefined && identity.properties === undefined;
  identity = { id, properties };
  if (active && !(again && identifiedId === id)) sendIdentity(id, properties);
}

/** Clear the identity + start a fresh anonymous session (call on sign-out).
 * reset() also clears PostHog's consent flag, which leaves it opted out
 * (opt_out_capturing_by_default), so it is opted in again straight after. */
export function resetAnalytics(): void {
  identity = null;
  identifiedId = null;
  if (!active) return;
  withActiveClient((ph) => {
    ph.reset();
    ph.opt_in_capturing({ captureEventName: false });
  });
}

/* ── learning-path pilot funnel ────────────────────────────────────────── */

/**
 * The four events the FDE path pilot needs, with an explicit allow-list of
 * properties.
 *
 * Nothing a learner wrote ever leaves the app: no code, no free text, no
 * artifact fields, no session token, no answer. Only ids that already appear
 * in the public manifest, plus a coarse outcome. `capture` is a no-op when
 * analytics is disabled, so the app works identically with it switched off.
 */
export type PathFunnelEvent =
  | 'learning_path_enrolled'
  | 'learning_path_activity_started'
  | 'learning_path_activity_verified'
  | 'learning_path_returned';

export interface PathFunnelProperties {
  /** 'fde' — a published id, not a learner's. */
  pathId: string;
  curriculumVersion: number;
  /** Manifest activity id. Public in the catalogue. */
  activityId?: string;
  /** 'lesson' | 'check' | 'code' | 'artifact'. */
  activityKind?: string;
  /** 'verified_pass' | 'self_reviewed' | 'needs_revision'. */
  state?: string;
}

const FUNNEL_KEYS: (keyof PathFunnelProperties)[] = [
  'pathId',
  'curriculumVersion',
  'activityId',
  'activityKind',
  'state',
];

export function capturePathEvent(event: PathFunnelEvent, properties: PathFunnelProperties): void {
  // Rebuilt from the allow-list rather than filtered, so a caller cannot pass
  // an extra field through by accident.
  const safe: Record<string, unknown> = {};
  for (const key of FUNNEL_KEYS) {
    const value = properties[key];
    if (value !== undefined) safe[key] = value;
  }
  capture(event, safe);
}

/** Activation events carry only catalogue identifiers, never code or answers.
 * A topic guide's event also names the language the guide was read in. */
export type ActivationEvent = 'landing_sample_completed' | 'learning_cta_clicked';
export type ActivationProperties =
  | { product: string; source: 'home'; category?: string }
  | { product: string; source: 'topic_guide'; locale: 'en'; category?: string };
export function captureActivation(event: ActivationEvent, properties: ActivationProperties): void {
  const { product, source, category } = properties;
  const locale = properties.source === 'topic_guide' ? { locale: properties.locale } : {};
  capture(event, { product, ...locale, source, ...(category ? { category } : {}) });
}
