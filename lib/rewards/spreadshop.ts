/** Spreadshop's own monthly promotion for the devShark shop (#229), so the
 * Rewards screen can say what Spreadshop is running this month.
 *
 * Spreadshop (sprd.net AG) prints, sells and ships devShark merchandise. It
 * runs promotions for its shops and devShark cannot create one, so this reads
 * the current one from the Public Shop API and nothing more:
 *
 *   GET https://api.spreadshirt.net/api/v1/shops/<shopId>/currentPromotion
 *   Authorization: SprdAuth apiKey="<key>"   User-Agent: app/version (site; email)
 *
 * 200 carries `{ description, validUntil, code }` (validUntil is ISO-8601 in
 * UTC without a zone); 404 means no promotion is running. The call runs on the
 * server only, so the key never reaches a browser and the CSP stays as it is.
 * Spreadshop asks for the answer to be cached for 30 minutes; a failure is
 * cached for 5, so an outage there never slows /api/settings for long.
 *
 *   SPREADSHOP_API_KEY        from partner.spreadshirt.net/apiKey (EU platform)
 *   SPREADSHOP_SHOP_ID        the numeric shop id
 *   SPREADSHOP_CONTACT_EMAIL  optional; Spreadshop wants a contact address in
 *                             the User-Agent of every request
 *
 * Without the first two nothing is fetched and the promotion is null. Coins
 * have nothing to do with it: they redeem whole items and never a discount. */

import { DEFAULT_PUBLIC_ORIGIN, parseOrigin } from '../billing/config';
import type { MerchPromo } from '../../shared/rewards';

type Env = Record<string, string | undefined>;

export interface SpreadshopConfig {
  url: string;
  headers: Record<string, string>;
}

const SPREADSHOP_API_ORIGIN = 'https://api.spreadshirt.net';
const FRESH_MS = 30 * 60 * 1000;
const FAILED_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 1500;
const MAX_DESCRIPTION = 160;

/** The request, or null when the shop is not configured. */
export function spreadshopConfig(env: Env = process.env): SpreadshopConfig | null {
  const apiKey = env.SPREADSHOP_API_KEY?.trim() ?? '';
  const shopId = env.SPREADSHOP_SHOP_ID?.trim() ?? '';
  if (!/^[A-Za-z0-9-]{8,64}$/.test(apiKey) || !/^\d{1,12}$/.test(shopId)) return null;
  const contact = env.SPREADSHOP_CONTACT_EMAIL?.trim() ?? '';
  const site = parseOrigin(env.PUBLIC_ORIGIN ?? DEFAULT_PUBLIC_ORIGIN);
  const about = /^[^\s@;()]+@[^\s@;()]+\.[^\s@;()]+$/.test(contact) ? `${site} ; ${contact}` : site;
  return {
    url: `${SPREADSHOP_API_ORIGIN}/api/v1/shops/${shopId}/currentPromotion?mediaType=json`,
    headers: {
      Authorization: `SprdAuth apiKey="${apiKey}"`,
      'User-Agent': `devShark/1.0 ( ${about} )`,
      Accept: 'application/json',
    },
  };
}

/** What the screen may show from one response, or null. Pure, so the launch
 * contracts can feed it every shape: a 404, a malformed body, an expired
 * promotion and a code with characters no checkout would take. */
export function parseSpreadshopPromotion(status: number, body: unknown, now: Date = new Date()): MerchPromo | null {
  if (status !== 200 || !body || typeof body !== 'object') return null;
  const raw = body as Record<string, unknown>;
  const description = typeof raw.description === 'string'
    ? raw.description.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
    : '';
  if (description.length === 0 || description.length > MAX_DESCRIPTION) return null;
  if (typeof raw.validUntil !== 'string') return null;
  const stamp = raw.validUntil.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(stamp)) return null;
  // Spreadshop sends UTC without a zone; read it as UTC, not as server time.
  const until = new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(stamp) ? stamp : `${stamp}Z`);
  if (Number.isNaN(until.getTime()) || until.getTime() <= now.getTime()) return null;
  const code = typeof raw.code === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(raw.code.trim()) ? raw.code.trim() : null;
  return { description, code, validUntil: until.toISOString() };
}

let cache: { key: string; value: MerchPromo | null; until: number } | null = null;
let inflight: { key: string; promise: Promise<MerchPromo | null> } | null = null;

/** Forget the cached answer. Tests only. */
export function resetMerchPromoCache(): void {
  cache = null;
  inflight = null;
}

/** The promotion running now, or null: not configured, none running, or
 * Spreadshop unreachable. Never throws. */
export async function getMerchPromo(options: {
  env?: Env;
  fetchImpl?: typeof fetch;
  now?: () => Date;
} = {}): Promise<MerchPromo | null> {
  const config = spreadshopConfig(options.env ?? process.env);
  if (!config) return null;
  const now = options.now ?? (() => new Date());
  const key = config.url;
  const fresh = (value: MerchPromo | null) =>
    value && new Date(value.validUntil).getTime() > now().getTime() ? value : null;

  if (cache && cache.key === key && cache.until > now().getTime()) return fresh(cache.value);
  if (inflight && inflight.key === key) return fresh(await inflight.promise);

  const run = (async (): Promise<MerchPromo | null> => {
    try {
      const response = await (options.fetchImpl ?? fetch)(config.url, {
        headers: config.headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.status === 404) {
        cache = { key, value: null, until: now().getTime() + FRESH_MS };
        return null;
      }
      if (!response.ok) throw new Error(`spreadshop_${response.status}`);
      const value = parseSpreadshopPromotion(response.status, await response.json(), now());
      cache = { key, value, until: now().getTime() + FRESH_MS };
      return value;
    } catch {
      cache = { key, value: null, until: now().getTime() + FAILED_MS };
      return null;
    } finally {
      inflight = null;
    }
  })();
  inflight = { key, promise: run };
  return fresh(await run);
}
