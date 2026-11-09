import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { withServerTiming, timedSupabaseFetch } from '../lib/request-timing';
import type { VercelResponse } from '../lib/vercel-types';
const fetch = globalThis.fetch;
const mock = () => {
 const headers: Record<string,string> = {};let sent=false;
 const res={statusCode:200,get headersSent(){return sent;},setHeader(n:string,v:unknown){assert.ok(!sent,'no header after send');headers[n]=String(v);return res;},status(c:number){res.statusCode=c;return res;},json(_v:unknown){sent=true;return res;},send(_v:unknown){sent=true;return res;},end(){sent=true;},redirect(){sent=true;return res;}} as VercelResponse;
 return {res,headers};
};
try {
 globalThis.fetch=async(input)=>{const url=String(input);assert.ok(url.startsWith('https://timing-fixture.test/'));await new Promise(r=>setTimeout(r,url.includes('/auth/')?15:30));return Response.json({fixture:true});};
 const first=mock(),second=mock();const original=first.res.json;
 await Promise.all([
  withServerTiming(first.res,async()=>{await timedSupabaseFetch('https://timing-fixture.test/rest/v1/private_table?secret=never-in-a-header');await timedSupabaseFetch('https://timing-fixture.test/auth/v1/user');first.res.json({ok:true});}),
  withServerTiming(second.res,async()=>{await Promise.all([timedSupabaseFetch('https://timing-fixture.test/rest/v1/a'),timedSupabaseFetch('https://timing-fixture.test/rest/v1/b')]);second.res.end();}),
 ]);
 assert.match(first.headers['Server-Timing'],/db_http;dur=[\d.]+;desc="1 calls"/);assert.match(first.headers['Server-Timing'],/auth_http;dur=[\d.]+;desc="1 calls"/);
 assert.match(second.headers['Server-Timing'],/db_http;dur=[\d.]+;desc="2 calls"/);assert.match(second.headers['Server-Timing'],/auth_http;dur=0.0;desc="0 calls"/);assert.equal(first.res.json,original);
 assert.ok(!JSON.stringify(first.headers).includes('secret'));assert.ok(!JSON.stringify(first.headers).includes('private_table'));
 const failed=mock();await assert.rejects(withServerTiming(failed.res,async()=>{throw new Error('fixture');}));assert.equal(failed.headers['Server-Timing'],undefined);
 const nested=mock();await withServerTiming(nested.res,()=>withServerTiming(nested.res,async()=>{await timedSupabaseFetch('https://timing-fixture.test/rest/v1/nested');nested.res.json({ok:true});}));
 assert.match(nested.headers['Server-Timing'],/db_http;dur=[\d.]+;desc="1 calls"/);
 console.log('PASS timing: overlapping request isolation, concurrent spans, response-before-send, no query/payload identifiers, method restoration');
}finally{globalThis.fetch=fetch;}
// What a fresh instance evaluates before it answers (#587): heavy modules
// load behind dynamic import() in the ops that need them.
await (await import('./cold-start-contracts')).coldStartContracts();
// The rate-limit prelude's round trips (#587), in a process of its own.
await (await import('./cold-start-contracts')).runIsolated('scripts/test-prelude.ts');
// The Learn branches' round trips (#587), in a process of their own.
await (await import('./cold-start-contracts')).runIsolated('scripts/test-learn-round-trips.ts');
// The served question set's refresh (#587), in a process of its own.
await (await import('./cold-start-contracts')).runIsolated('scripts/test-questions-cache.ts');

// The self-host adapter's IP and body-size boundaries, on a local fixture.
execFileSync(process.execPath, ['--test', 'docker/server.test.mjs'], { stdio: 'inherit' });
