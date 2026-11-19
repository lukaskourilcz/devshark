// Fresh timing module in a separate CJS process for every case.
import assert from 'node:assert/strict';
import { loadFresh } from './cold-start-contracts';

const fixtures = `
  const mock = (cache) => {
    const headers = {}; let sent = false;
    const res = { statusCode: 200, get headersSent() { return sent; },
      setHeader(name, value) { if (sent) throw new Error('late header'); headers[name.toLowerCase()] = value; return this; },
      getHeader(name) { return headers[name.toLowerCase()]; },
      status(code) { this.statusCode = code; return this; },
      json() { sent = true; return this; }, send() { sent = true; return this; }, end() { sent = true; }, redirect() { sent = true; return this; } };
    if (cache !== undefined) res.setHeader('Cache-Control', cache);
    return { res, headers };
  };
  const marker = value => /(?:^|,)\\s*instance;desc="(first|repeat)"/.exec(value || '')?.[1] || null;
`;
async function probe(body: string): Promise<any> {
  const fresh = await loadFresh('lib/request-timing.ts', `(async () => { ${fixtures} ${body} })()`);
  return fresh.probe;
}
export async function timingInstanceContracts(): Promise<void> {
  const reverse = await probe(`
    const slow = mock('private, no-store'), fast = mock('private, no-store');
    let release; const gate = new Promise(resolve => { release = resolve; });
    const waiting = mod.withServerTiming(slow.res, async () => { await gate; slow.res.json({}); });
    await mod.withServerTiming(fast.res, () => fast.res.send({}));
    release(); await waiting;
    return [marker(slow.headers['server-timing']), marker(fast.headers['server-timing'])];
  `);
  assert.deepEqual(reverse, ['first', 'repeat'], 'claim by entry order, not response completion');

  for (const cache of [undefined, 'private', 'public, max-age=60', 'PUBLIC, NO-STORE', 'private, no-store, MAX-AGE="60"', 'no-store, s-maxage=0', ['private', 'no-store', 'stale-while-revalidate=60'], 0, 'no-store, unknown=1']) {
    const result = await probe(`
      const first = mock(${JSON.stringify(cache) ?? 'undefined'}), next = mock('private, no-store');
      await mod.withServerTiming(first.res, () => first.res.json({}));
      await mod.withServerTiming(next.res, () => next.res.json({}));
      return [marker(first.headers['server-timing']), marker(next.headers['server-timing'])];
    `);
    assert.deepEqual(result, [null, 'repeat'], 'unclassifiable/cacheable first response consumes but does not expose first');
  }
  for (const cache of ['private, no-store', ' NO-STORE , PRIVATE ', ['no-store', 'private'], 'no-store, max-age=0']) {
    const result = await probe(`const first = mock(${JSON.stringify(cache)}); await mod.withServerTiming(first.res, () => first.res.end()); return marker(first.headers['server-timing']);`);
    assert.equal(result, 'first');
  }
  const finalPolicy = await probe(`
    const first = mock('private, no-store'), next = mock('public, max-age=60');
    await mod.withServerTiming(first.res, () => { first.res.setHeader('Cache-Control', 'public, s-maxage=60'); first.res.json({}); });
    await mod.withServerTiming(next.res, () => { next.res.setHeader('Cache-Control', 'private, no-store'); next.res.json({}); });
    return [marker(first.headers['server-timing']), marker(next.headers['server-timing'])];
  `);
  assert.deepEqual(finalPolicy, [null, 'repeat'], 'read the final cache policy immediately before write');
  const nested = await probe(`
    const first = mock('private, no-store'), next = mock('private, no-store');
    const original = [first.res.json, first.res.send, first.res.end];
    await mod.withServerTiming(first.res, () => mod.withServerTiming(first.res, () => first.res.json({})));
    await mod.withServerTiming(next.res, () => next.res.json({}));
    return { markers: [marker(first.headers['server-timing']), marker(next.headers['server-timing'])], restored: original.every((fn,index) => fn === [first.res.json, first.res.send, first.res.end][index]) };
  `);
  assert.deepEqual(nested, { markers: ['first', 'repeat'], restored: true });
  const failed = await probe(`
    const first = mock('private, no-store'), next = mock('private, no-store');
    const original = first.res.json;
    try { await mod.withServerTiming(first.res, () => { throw new Error('fixture'); }); } catch {}
    await mod.withServerTiming(next.res, () => next.res.json({}));
    return { absent: first.headers['server-timing'] === undefined, restored: first.res.json === original, next: marker(next.headers['server-timing']) };
  `);
  assert.deepEqual(failed, { absent: true, restored: true, next: 'repeat' });
  const noWrite = await probe(`
    const first = mock('private, no-store'), next = mock('private, no-store'); const original = first.res.json;
    await mod.withServerTiming(first.res, () => 'no write'); await mod.withServerTiming(next.res, () => next.res.json({}));
    return { absent: first.headers['server-timing'] === undefined, restored: first.res.json === original, next: marker(next.headers['server-timing']) };
  `);
  assert.deepEqual(noWrite, { absent: true, restored: true, next: 'repeat' });
  const unknownGetter = await probe(`
    const first = mock('private, no-store'), next = mock('private, no-store'); delete first.res.getHeader;
    await mod.withServerTiming(first.res, () => first.res.json({})); await mod.withServerTiming(next.res, () => next.res.json({}));
    return [marker(first.headers['server-timing']), marker(next.headers['server-timing'])];
  `);
  assert.deepEqual(unknownGetter, [null, 'repeat']);
  console.log('PASS timing instance: synchronous claim, nested/concurrent isolation, final no-store policy, omitted cached/unknown markers and method restoration');
}
