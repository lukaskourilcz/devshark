// Optional frontdoor access only. No exchange, application auth or cookie jar.
import { closeSync, constants, fstatSync, ftruncateSync, lstatSync, openSync, readSync, writeFileSync } from 'node:fs';

export class PreviewAccessError extends Error {
  constructor() { super('invalid protected Preview access state'); }
}
const fail = () => { throw new PreviewAccessError(); };
export function validatePreviewOrigin(origin) {
  let target;
  try { target = new URL(origin); } catch { fail(); }
  if (target.protocol !== 'https:' || target.port || target.origin !== origin ||
      target.username || target.password || target.pathname !== '/' || target.search || target.hash ||
      !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/.test(target.hostname)) fail();
  return target;
}
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export function loadPreviewAccess(origin, file, nowMs = Date.now()) {
  const target = validatePreviewOrigin(origin);
  let descriptor;
  let state;
  let identity;
  try {
    // Fail closed on hosts that cannot provide the required file boundary.
    if (typeof constants.O_NOFOLLOW !== 'number' || typeof constants.O_NONBLOCK !== 'number') fail();
    // A FIFO must not block before fstat can reject its non-regular type.
    descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size < 1 || stat.size > 32768 || (stat.mode & 0o077) !== 0 ||
        (typeof process.getuid === 'function' && stat.uid !== process.getuid())) fail();
    identity = { dev: stat.dev, ino: stat.ino };
    // Bound the actual read too, even if an owner changes the file after stat.
    const bytes = Buffer.alloc(32769);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(descriptor, bytes, length, bytes.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length < 1 || length > 32768) fail();
    state = JSON.parse(bytes.subarray(0, length).toString('utf8'));
  } catch { fail(); }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
  if (!exactKeys(state, ['cookies', 'origins']) || !Array.isArray(state.cookies) || state.cookies.length !== 1 ||
      !Array.isArray(state.origins) || state.origins.length !== 0) fail();
  const cookie = state.cookies[0];
  if (!exactKeys(cookie, ['name', 'value', 'domain', 'path', 'expires', 'httpOnly', 'secure', 'sameSite']) ||
      cookie.name !== '_vercel_jwt' || cookie.domain !== target.hostname || cookie.path !== '/' ||
      cookie.secure !== true || cookie.httpOnly !== true || !['Lax', 'Strict'].includes(cookie.sameSite) ||
      !(cookie.expires === -1 || (Number.isFinite(cookie.expires) && cookie.expires > nowMs / 1000)) ||
      typeof cookie.value !== 'string' || cookie.value.length < 20 || cookie.value.length > 8192 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(cookie.value)) fail();
  // Format checks constrain this observed protocol; Vercel validates its JWT.
  // Never decode claims, verify a guessed signing key, print or rewrite state.
  let value = cookie.value;
  const sameInput = stat => stat.dev === identity.dev && stat.ino === identity.ino;
  return Object.freeze({
    kind: 'approved-vercel-preview-state',
    headersFor(url) {
      if (!value || !(url instanceof URL) || url.origin !== target.origin || url.protocol !== 'https:') fail();
      return { Cookie: `_vercel_jwt=${value}`, 'x-vercel-skip-toolbar': '1' };
    },
    assertOutputAllowed(file) {
      try {
        const stat = lstatSync(file);
        if (!stat.isFile() || sameInput(stat)) fail();
      } catch (error) { if (error?.code !== 'ENOENT') fail(); }
    },
    // The identity remains private after cookie disposal. Open before checking,
    // without truncation, so a late alias cannot redirect a subsequent write.
    writeReport(file, content) {
      let output;
      try {
        output = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
        const stat = fstatSync(output);
        if (!stat.isFile() || sameInput(stat)) fail();
        ftruncateSync(output, 0);
        writeFileSync(output, content);
      } catch { fail(); }
      finally { if (output !== undefined) closeSync(output); }
    },
    dispose() { value = ''; },
  });
}
