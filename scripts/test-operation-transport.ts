// Real locked Redis client, loopback HTTP only. A request has no app identity.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Redis } from '@upstash/redis';
import { withRequestContext } from '../lib/http';
import type { VercelResponse } from '../lib/vercel-types';
import { requestOperation } from '../lib/request-operation';
import { observeRedisTransport, upstreamSummary, withServerTiming } from '../lib/request-timing';
const { timingSpans } = await import(pathToFileURL(resolve('scripts/perf-cold-start.mjs')).href);

for (const [url, query, expected] of [
  ['/api/quiz/roadmap?id=do-not-log', {resource:'coding-task'}, 'quiz/roadmap:coding-task'],
  ['/api/quiz/daily', {qotd:'2026-11-24'}, 'quiz/daily:qotd'],
  ['/api/user/friends-lookup', {op:'FRIENDS-LOOKUP'}, 'user:friends-lookup'],
  ['/api/leaderboard', {period:'30d'}, 'leaderboard:30d'],
  ['/api/user/private-input', {op:'private-input'}, 'user:other'],
  ['/api/quiz/challenge', {resource:['private-input','private-input']}, 'quiz/challenge:other'],
  ['/api/quiz/questions', {resource:'constructor'}, 'quiz/questions:other'],
  ['/some/private/path', {}, 'other'],
] as const) {
  assert.equal(requestOperation({url,query:query as Record<string,string|string[]>}), expected);
}

let wireRequests = 0, retryOnce = true;
const server = createServer(async (req, res) => {
  wireRequests++;
  let body = '';
  for await (const chunk of req) body += chunk;
  if (req.url === '/retry' && retryOnce) { retryOnce = false; req.socket.destroy(); return; }
  const command = JSON.parse(body);
  const reply = Array.isArray(command[0]) ? command.map(() => ({result:'ok'})) : {result:'ok'};
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(reply));
});
server.listen(0,'127.0.0.1'); await once(server,'listening');
try {
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  observeRedisTransport(origin);
  const client = (path = '') => new Redis({url:origin + path,token:'fixture',enableAutoPipelining:false,retry:{retries:1,backoff:()=>0}});
  const normal = client(), retries = client('/retry');
  async function measure(run: () => Promise<unknown>, count: number) {
    const headers = new Map<string,string>();
    const res = {setHeader(k: string,v: string) {headers.set(k,v);},end() {}} as unknown as VercelResponse;
    await withServerTiming(res,async () => {
      await run(); res.end();
      const { db_calls, auth_calls, redis_calls } = upstreamSummary();
      assert.deepEqual([db_calls, auth_calls, redis_calls], [0, 0, count]);
    });
    const spans = timingSpans(headers.get('Server-Timing'));
    assert.equal(spans.valid,true); assert.equal(spans.redisCalls,count); assert.ok(spans.redisHttpMs >= 0);
  }
  await Promise.all([
    measure(() => normal.pipeline().get('a').get('b').exec(),1),
    measure(() => retries.ping(),2),
    measure(async() => {},0),
  ]);
  assert.equal(wireRequests,3);
  const records: string[] = [];
  const originalLog = console.log;
  console.log = (line: string) => { records.push(line); };
  try {
    const out = { setHeader() {}, end() {} } as unknown as VercelResponse;
    await withRequestContext({ method: 'GET', url:'/api/quiz/roadmap?resource=coding-task&id=private-fixture', headers:{}, socket:{}, query:{resource:'coding-task',id:'private-fixture'} }, out, async () => {
      await normal.ping(); out.end();
    });
  } finally { console.log = originalLog; }
  const summary = records.map(line => JSON.parse(line)).find(record => record.route === 'request');
  assert.equal(summary.operation,'quiz/roadmap:coding-task');
  assert.equal(summary.redis_calls,1);
  assert.ok(Number.isInteger(summary.redis_http_ms) && summary.redis_http_ms >= 0);
  assert.equal(summary.db_calls,0);
  assert.equal(summary.auth_calls,0);
  assert.ok(!records.join('').includes('private-fixture'));

  console.log('PASS finite operation labels and per-request Redis HTTP counts: 2-command pipeline 1, retried request 2, concurrent idle request 0');
} finally { server.closeAllConnections(); await new Promise<void>(resolve=>server.close(()=>resolve())); }
