// The PostHog client and its settings. lib/analytics.ts imports this file
// only after the visitor says yes to analytics, so posthog-js, these settings
// and the URL scrubber travel in one lazy chunk and never in the shell.

import posthog, { type PostHog, type PostHogConfig } from 'posthog-js';
import { CAMPAIGN_KEYS, campaignLabel, scrubUrl } from './analytics';

/** A URL or referrer property as analytics may see it. PostHog's `$direct`
 * (no referrer) is a label, not an address, and stays. */
const scrubUrlValue = (value: string): string => (value === '$direct' ? value : scrubUrl(value, true));

const CAMPAIGN_LABELS = new Set<string>(CAMPAIGN_KEYS);
// PostHog also extracts click ids, ad/mail fields and search text from URLs
// into separate properties. They have no role in devShark's attribution.
const OTHER_ATTRIBUTION = new Set([
  'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'fbclid', 'fbc', 'msclkid',
  'twclid', 'li_fat_id', 'igshid', 'ttclid', 'rdt_cid', 'epik', 'qclid',
  'sccid', 'irclid', '_kx', 'gad_source', 'mc_cid', 'ph_keyword',
]);

/** Keep only approved campaign labels in URL and attribution fields,
 * including those the SDK extracts for the session and the person. */
function scrubEvent<T extends { properties?: Record<string, unknown>; $set?: Record<string, unknown>; $set_once?: Record<string, unknown> } | null>(event: T): T {
  if (!event) return event;
  for (const bag of [event.properties, event.$set, event.$set_once, event.properties?.$set as Record<string, unknown> | undefined, event.properties?.$set_once as Record<string, unknown> | undefined]) {
    if (!bag || typeof bag !== 'object') continue;
    for (const key of Object.keys(bag)) {
      const value = bag[key];
      const field = key.replace(/^\$?(?:(?:initial|session_entry)_)*\$?/, '');
      if (CAMPAIGN_LABELS.has(field)) {
        const label = campaignLabel(value);
        if (label) bag[key] = label;
        else delete bag[key];
      } else if (field.startsWith('utm_') || OTHER_ATTRIBUTION.has(field)) {
        delete bag[key];
      }
      if (/(_url|referrer)$/.test(key) && typeof value === 'string') bag[key] = scrubUrlValue(value);
      if (key === '$initial_person_info' && value && typeof value === 'object') {
        const info = value as { u?: unknown; r?: unknown };
        if (typeof info.u === 'string') info.u = scrubUrlValue(info.u);
        if (typeof info.r === 'string') info.r = scrubUrlValue(info.r);
      }
    }
  }
  return event;
}

/** The settings the client starts with. Exported for the test that runs
 * them in the real posthog-js. */
export function posthogConfig(apiHost: string): Partial<PostHogConfig> {
  return {
    api_host: apiHost,
    // Where the SDK sends users for the toolbar / links (EU Cloud UI).
    ui_host: 'https://eu.posthog.com',
    person_profiles: 'identified_only',
    // We drive SPA pageviews manually from the router (capturePageview),
    // but let PostHog measure how long each view was open.
    capture_pageview: false,
    capture_pageleave: true,
    respect_dnt: true,
    autocapture: false,
    disable_session_recording: true,
    capture_dead_clicks: false,
    // devShark supplies its own campaign labels. PostHog still derives
    // session and initial properties, so before_send filters those too.
    save_campaign_params: false,
    mask_personal_data_properties: true,
    // A fragment can carry a token (a cancel confirmation, an OAuth return);
    // PostHog leaves it out of the URLs it records itself.
    disable_capture_url_hashes: true,
    // Out, and storing nothing, until the caller opts in. PostHog reads its
    // own consent flag from storage on every check, so once a withdrawal has
    // removed that flag it must fall back to "out", never "in".
    persistence: 'localStorage+cookie',
    opt_out_capturing_by_default: true,
    opt_out_persistence_by_default: true,
    // Each event leaves when it is captured. Batched, an event waited up to
    // three seconds in PostHog's queue, which neither reset() nor an opt-out
    // empties, so one captured just before a withdrawal was sent after it.
    request_batching: false,
    before_send: (event) => scrubEvent(event),
  };
}

/** Initialise the singleton client, opted out and storing nothing. The
 * caller opts it in. */
export function startPostHog(key: string, apiHost: string): PostHog {
  posthog.init(key, posthogConfig(apiHost));
  return posthog;
}
