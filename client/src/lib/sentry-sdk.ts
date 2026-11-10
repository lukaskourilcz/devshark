// A closed export boundary lets Rollup remove Replay/profiling and unused SDK
// APIs. Keeping the entire dynamic-import namespace alive retained them even
// though devShark only initializes monitoring and reports exceptions.
//
// The scrubber below travels in this lazy chunk with the SDK, so the shell
// carries none of it.
import type { Breadcrumb, Event } from '@sentry/react';
import { init, browserTracingIntegration, captureException } from '@sentry/react';
import type { EarlyError } from './sentry';

export { captureException } from '@sentry/react';

/** Start monitoring, then send the errors lib/sentry.ts kept while this
 * chunk loaded. The options live here, in the lazy chunk, so the shell
 * carries only the DSN check, the queue and the import (lib/sentry.ts). */
export function start(dsn: string, environment: string, early: EarlyError[] = []): void {
  init({
    dsn,
    environment,
    // Performance tracing (Web Vitals + transactions) at a low sample rate,
    // without the cost of full sampling or Session Replay.
    // `linkPreviousTrace: 'in-memory'` is the SDK's default, pinned: the
    // other setting keeps the last trace in sessionStorage.
    integrations: [browserTracingIntegration({ linkPreviousTrace: 'in-memory' })],
    tracesSampleRate: 0.1,
    // No IP address, cookies or user context. Error monitoring runs for
    // every visitor without asking (lib/consent.ts, "necessary") only
    // because it stores nothing in the browser and carries no identifier
    // of the person: no cookie, no storage key, no Session Replay, no
    // setUser. Keep it that way, or put it under analytics consent.
    sendDefaultPii: false,
    // sendDefaultPii leaves addresses whole: every event, breadcrumb and
    // span loses its query strings, fragments, e-mail addresses and tokens
    // here (scrubEvent and scrubBreadcrumb below).
    beforeSend: (event) => scrubEvent(event),
    beforeSendTransaction: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
  });
  // Through the same scrubbing as every other event (beforeSend above).
  for (const [error, context, uncaughtBy] of early) {
    captureException(error, uncaughtBy ? { mechanism: { type: uncaughtBy, handled: false } } : context ? { extra: context } : undefined);
  }
}

/* ── what an event may carry ─────────────────────────────────────────────
 * Error monitoring runs without asking only while it sends no personal data
 * (lib/sentry.ts). The SDK copies the full address into every event, every
 * navigation and request breadcrumb and every request span, and an address
 * here can hold a sign-in code (`?code=`), a Supabase session in the fragment
 * (`#access_token=`), a Stripe `session_id`, a voucher or a GitHub
 * installation's `state`. Every address keeps its origin and path only, every
 * free text loses e-mail addresses, tokens and the query strings of the
 * addresses inside it, and nothing names the person. */

// A URL can carry credentials before the hostname as well as after it.
const URL_USERINFO = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s\/@?#"'<>]+@/gi;

/** An address without its query string or fragment; absolute or relative. */
export function scrubAddress(value: string): string {
  const cut = value.search(/[?#]/);
  return (cut === -1 ? value : value.slice(0, cut)).replace(URL_USERINFO, '$1');
}

const ABSOLUTE_URL_TAIL = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#"'<>`]*)[?#][^\s"'<>`]*/gi;
const RELATIVE_URL_TAIL = /(^|[\s("'`])(\/[^\s?#"'<>`]*)[?#][^\s"'<>`)]*/g;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
const JWT = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const BEARER = /\bBearer\s+[\w.~+/-]{8,}=*/gi;

/** Free text (a message, an error's value, a breadcrumb) without the parts
 * that could identify a person or open their account. */
export function scrubText(value: string): string {
  return value
    .replace(URL_USERINFO, '$1')
    .replace(ABSOLUTE_URL_TAIL, '$1')
    .replace(RELATIVE_URL_TAIL, '$1$2')
    .replace(JWT, '[token]')
    .replace(BEARER, 'Bearer [token]')
    .replace(EMAIL, '[email]');
}

/** Keys whose value is an address, absolute or relative (navigation `from`
 * and `to`, request `url`, span `http.url` and `url.full`). */
const ADDRESS_KEY = /^(?:url|from|to)$|(?:^|\.)(?:url|full|target)$/;
/** Keys that hold an address's query string or fragment on their own. */
const QUERY_KEY = /(?:^|[._])(?:query|fragment|query_string)$/;

// Keep diagnostics scalar. Objects may contain headers, credentials, user
// data or exception arguments with fields the scrubber cannot recognise.
const SENSITIVE_KEY = /(?:^|[._-])(?:authorization|cookie|password|token|secret)(?:$|[._-])/i;

function scrubBag(bag: Record<string, unknown> | undefined): void {
  if (!bag || typeof bag !== 'object') return;
  for (const key of Object.keys(bag)) {
    const value = bag[key];
    if (QUERY_KEY.test(key) || SENSITIVE_KEY.test(key) || key === 'arguments' || key === '__serialized__' ||
        (value !== null && typeof value === 'object')) {
      delete bag[key];
      continue;
    }
    if (typeof value === 'string') bag[key] = scrubText(ADDRESS_KEY.test(key) ? scrubAddress(value) : value);
  }
}

/** One breadcrumb as monitoring may keep it. */
export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb {
  if (typeof crumb.message === 'string') crumb.message = scrubText(crumb.message);
  scrubBag(crumb.data);
  return crumb;
}

/** An error or a transaction as monitoring may send it. */
export function scrubEvent<T extends Event>(event: T): T {
  delete event.user;
  if (event.request) {
    if (typeof event.request.url === 'string') event.request.url = scrubText(scrubAddress(event.request.url));
    delete event.request.query_string;
    delete event.request.cookies;
    delete event.request.data;
    // The Referer is the previous address with its query string; the browser
    // name is all the request headers need to say.
    const agent = event.request.headers?.['User-Agent'];
    if (agent) event.request.headers = { 'User-Agent': agent };
    else delete event.request.headers;
  }
  if (typeof event.message === 'string') event.message = scrubText(event.message);
  if (typeof event.transaction === 'string') event.transaction = scrubAddress(event.transaction);
  for (const exception of event.exception?.values ?? []) {
    if (typeof exception.value === 'string') exception.value = scrubText(exception.value);
  }
  for (const crumb of event.breadcrumbs ?? []) scrubBreadcrumb(crumb);
  scrubBag(event.extra);
  scrubBag(event.contexts?.trace?.data as Record<string, unknown> | undefined);
  for (const span of event.spans ?? []) scrubBag(span.data as Record<string, unknown> | undefined);
  return event;
}
