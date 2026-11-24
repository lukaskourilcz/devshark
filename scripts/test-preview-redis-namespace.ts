import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

async function captureKeys() {
  const keys: string[] = [];
  globalThis.fetch = async (input, init) => {
    assert.equal(new URL(String(input)).origin, 'http://127.0.0.1:1');
    const payload = JSON.parse(String(init?.body));
    const reply = (command: unknown[]) => {
      const name = String(command[0]).toLowerCase();
      if (name === 'set') { keys.push(String(command[1])); return {result:'OK'}; }
      assert.ok(name === 'evalsha' || name === 'eval');
      const key = String(command[3]); keys.push(key);
      if (key.includes('payment-webhook:')) return {result:command[4]};
      const limit = Number(command[3 + Number(command[2])]);
      return {result:[limit - 1,limit]};
    };
    return Response.json(Array.isArray(payload[0]) ? payload.map(reply) : reply(payload));
  };
  const { enforceRateLimit, claimOnce, claimPaymentDelivery } = await import('../lib/rate-limit');
  const res = {setHeader() {}};
  assert.equal(await enforceRateLimit({headers:{},query:{},socket:{remoteAddress:'127.0.0.1'}} as never, res as never, {key:'fixture',capacity:10,refillPerSecond:1},'fixture'),true);
  assert.equal(await claimOnce('fixture',30),true);
  const done = await claimPaymentDelivery('fixture'); assert.equal(typeof done,'function'); await done!(true);
  console.log(JSON.stringify(keys));
}

if (process.argv[2] === '--read-fixture') {
  await captureKeys();
} else {
  for (const [vercel, namespace, prefix] of [
    ['preview','epic-f-20261124','preview:epic-f-20261124:'], ['preview',undefined,''], ['production','epic-f-20261124',''],
    ['production','bad/field',''], ['preview','bad/field',null], ['preview','',null],
  ] as const) {
    const env: Record<string,string> = {VERCEL_ENV:vercel,UPSTASH_REDIS_REST_URL:'http://127.0.0.1:1',UPSTASH_REDIS_REST_TOKEN:'fixture'};
    if (namespace !== undefined) env.DEVSHARK_PREVIEW_REDIS_NAMESPACE = namespace;
    const run = spawnSync(process.execPath,[process.argv[1],'--read-fixture'],{env,encoding:'utf8'});
    if (prefix === null) { assert.notEqual(run.status,0);assert.match(run.stderr,/Invalid DEVSHARK_PREVIEW_REDIS_NAMESPACE/);continue; }
    assert.equal(run.status,0,run.stderr);
    const keys: string[] = JSON.parse(run.stdout.trim().split('\n').at(-1)!);
    assert.equal(keys.length,4);
    assert.ok(keys[0].startsWith(`${prefix}rl:fixture:`));
    assert.deepEqual(keys.slice(1),[`${prefix}once:fixture`,`${prefix}payment-webhook:fixture`,`${prefix}payment-webhook:fixture`]);
  }
  console.log('PASS Preview Redis namespace: 6 configurations across limiter, one-time claim and payment receipt');
}
