import { createHash } from 'node:crypto';
import type { VercelRequest, VercelResponse } from './vercel-types.js';

/** If-None-Match uses weak comparison for a public GET. Quoted opaque tags
 * may contain commas; only commas outside the quotes separate list members.
 * Unknown or malformed syntax falls back to sending the representation. */
export function matchesEntityTag(header: string | string[] | undefined, etag: string): boolean {
  const expected = /^(?:W\/)?("[\x21\x23-\x7e\x80-\xff]*")$/.exec(etag)?.[1];
  const value = Array.isArray(header) ? header.join(',') : header;
  if (!expected || !value) return false;
  if (/^[\t ]*\*[\t ]*$/.test(value)) return true;
  let cursor = 0;
  let matched = false;
  while (cursor < value.length) {
    // Empty list members are ignored, as in HTTP's list syntax.
    while (cursor < value.length && /[\t ,]/.test(value[cursor])) cursor++;
    if (cursor === value.length) break;
    if (value.startsWith('W/', cursor)) cursor += 2;
    if (value[cursor] !== '"') return false;
    const start = cursor++;
    while (cursor < value.length && value[cursor] !== '"') {
      const code = value.charCodeAt(cursor++);
      if (!(code === 0x21 || (code >= 0x23 && code <= 0x7e) || (code >= 0x80 && code <= 0xff))) return false;
    }
    if (value[cursor] !== '"') return false;
    cursor++;
    if (value.slice(start, cursor) === expected) matched = true;
    while (cursor < value.length && /[\t ]/.test(value[cursor])) cursor++;
    if (cursor < value.length && value[cursor++] !== ',') return false;
  }
  return matched;
}

/** Called after the existing route gates and public JSON projection. This
 * preserves the current response policy and writes through the same JSON
 * adapter. Revalidation still performs the route's normal reads. */
export function sendPublicJson(req: VercelRequest, res: VercelResponse, body: unknown) {
  let policy: string | readonly string[] | number | undefined;
  try { policy = res.getHeader?.('Cache-Control'); }
  catch { return res.json(body); }
  if (Array.isArray(policy)) policy = policy.join(',');
  const fields = typeof policy === 'string' ? policy.split(',').map((field) => field.trim()) : [];
  const publicPolicy = fields.some((field) => /^public$/i.test(field))
    && !fields.some((field) => /^(?:private|no-store)(?:\s*=|$)/i.test(field));
  if (req.method !== 'GET' || (res.statusCode ?? 200) !== 200 || !publicPolicy) return res.json(body);
  const content = JSON.stringify(body);
  if (content === undefined) return res.json(body);
  const etag = `W/"${createHash('sha256').update(content).digest('hex')}"`;
  res.setHeader('ETag', etag);
  if (matchesEntityTag(req.headers['if-none-match'], etag)) return res.status(304).end();
  return res.json(body);
}
