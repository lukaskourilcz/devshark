// Aggregate transport timings only: no SQL, URL, identity, tokens or payloads.
import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import type { VercelResponse } from './vercel-types';

type Timing = { response: VercelResponse; start: number; dbMs: number; dbCalls: number; authMs: number; authCalls: number };
const timings = new AsyncLocalStorage<Timing>();
// This is a claim on this timing-module instance, not a platform boot clock.
let entered = false;

/** Fail closed: only explicit no-store with no shared/positive cache policy.
 * Private without no-store can still be stored by a browser, so omit there.
 */
function exposeInstanceMarker(value: unknown): boolean {
  if (Array.isArray(value)) value = value.join(',');
  if (typeof value !== 'string' || !value.trim()) return false;
  let noStore = false;
  for (const field of value.split(',')) {
    const match = /^\s*([a-z-]+)(?:\s*=\s*(\d+|"\d+"))?\s*$/i.exec(field);
    if (!match) return false;
    const name = match[1].toLowerCase();
    if (name === 'max-age') {
      if (match[2] === undefined || Number(match[2].replaceAll('"', '')) !== 0) return false;
      continue;
    }
    if (!['private', 'no-store', 'no-cache', 'must-revalidate', 'proxy-revalidate', 'no-transform'].includes(name) || match[2] !== undefined) return false;
    if (name === 'no-store') noStore = true;
  }
  return noStore;
}

/** Supabase HTTP time to response headers, INCLUDING network, NOT SQL CPU.
 * Parallel spans overlap and must not be subtracted from app duration.
 * A request joining another request's cache miss initiates no transport call.
 */
export const timedSupabaseFetch: typeof fetch = async (input, init) => {
  const timing = timings.getStore();
  const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname;
  const kind = path.startsWith('/rest/v1/') ? 'db' : path.startsWith('/auth/v1/') ? 'auth' : null;
  if (!timing || !kind) return globalThis.fetch(input, init);
  const start = performance.now();
  if (kind === 'db') timing.dbCalls++; else timing.authCalls++;
  try { return await globalThis.fetch(input, init); }
  finally {
    if (kind === 'db') timing.dbMs += performance.now() - start;
    else timing.authMs += performance.now() - start;
  }
};

/** Headers are set before the first response write, not in an after-send
 * finally. Public CDN hits replay origin timings; they are not fresh spans.
 */
export async function withServerTiming<T>(res: VercelResponse, run: () => T): Promise<Awaited<T>> {
  if (timings.getStore()?.response === res) return await run();
  // Claim before the first await; public/failed/no-write requests consume it.
  const first = !entered;
  entered = true;
  const timing: Timing = { response: res, start: performance.now(), dbMs: 0, dbCalls: 0, authMs: 0, authCalls: 0 };
  return await timings.run(timing, async () => {
    let written = false;
    const writeHeader = () => {
      if (written || res.headersSent) return;
      written = true;
      let marker = '';
      // Read the final policy at the first write. Structural mocks/adapters
      // without a getter expose no marker; they retain the aggregate spans.
      try {
        if (exposeInstanceMarker(res.getHeader?.('Cache-Control'))) marker = `, instance;desc="${first ? 'first' : 'repeat'}"`;
      } catch { /* unknown cache policy: omit rather than track/alter it */ }
      res.setHeader('Server-Timing', `app;dur=${(performance.now() - timing.start).toFixed(1)}, db_http;dur=${timing.dbMs.toFixed(1)};desc="${timing.dbCalls} calls", auth_http;dur=${timing.authMs.toFixed(1)};desc="${timing.authCalls} calls"${marker}`);
    };
    const json = res.json, send = res.send, end = res.end;
    if (json) res.json = function(body) { writeHeader(); return json.call(this, body); };
    if (send) res.send = function(body) { writeHeader(); return send.call(this, body); };
    if (end) res.end = function(body) { writeHeader(); return end.call(this, body); };
    try { return await run(); }
    finally { if (json) res.json = json; if (send) res.send = send; if (end) res.end = end; }
  });
}
