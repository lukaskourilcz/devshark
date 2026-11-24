import type { VercelRequest } from './vercel-types.js';

// Vercel may supply a parsed object and replay the original request stream.
// Verify the original wire representation first, then any available buffered body.
type StreamLike = {
  on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  readableEnded?: boolean;
};

function readStream(req: VercelRequest, timeoutMs: number): Promise<string | null> {
  const stream = req as unknown as StreamLike;
  // A stream a runtime has read already sends no more events: waiting for
  // them would only add the whole timeout to every delivery.
  if (typeof stream.on !== 'function' || stream.readableEnded === true) return Promise.resolve(null);
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let done = false;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stream.removeListener?.('data', onData);
      stream.removeListener?.('end', onEnd);
      stream.removeListener?.('error', onError);
      resolve(value);
    };
    const onData = (chunk: unknown) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'));
    };
    const onEnd = () => finish(chunks.length ? Buffer.concat(chunks).toString('utf8') : null);
    const onError = () => finish(null);
    const timer = setTimeout(() => finish(null), timeoutMs);
    stream.on!('data', onData);
    stream.on!('end', onEnd);
    stream.on!('error', onError);
  });
}

/** The strings the signature may cover, most faithful first. */
export async function rawBodyCandidates(req: VercelRequest, timeoutMs = 1500): Promise<string[]> {
  const out: string[] = [];
  const add = (value: string | null | undefined) => {
    if (typeof value === 'string' && value.length > 0 && !out.includes(value)) out.push(value);
  };
  add(await readStream(req, timeoutMs));
  const body = req.body as unknown;
  if (typeof body === 'string') add(body);
  else if (Buffer.isBuffer(body)) add(body.toString('utf8'));
  else if (body && typeof body === 'object') {
    add(JSON.stringify(body));
    add(JSON.stringify(body, null, 2));
  }
  return out;
}

