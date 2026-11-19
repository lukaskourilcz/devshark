import assert from 'node:assert/strict';
import { readVercelConfig, vercelRoutingContracts } from './vercel-routing-contract';

type Config = ReturnType<typeof readVercelConfig>;
const check: (config: Config) => void = vercelRoutingContracts;

/** Keep the one retired private asset exception narrower than generic 404s. */
export function vercelRoutingFixtureContracts(): void {
  const original = readVercelConfig();
  const fresh = () => structuredClone(original);
  const privateIndex = (config: Config) => config.routes!.findIndex(route => route.status === 404 && !route.dest);
  const privateRule = (config: Config) => config.routes![privateIndex(config)];
  check(fresh());

  const rejected: [string, (config: Config) => void][] = [
    ['missing retirement rule', config => { config.routes!.splice(privateIndex(config), 1); }],
    ['duplicate retirement rule', config => { config.routes!.splice(privateIndex(config), 0, structuredClone(privateRule(config))); }],
    ['retirement after filesystem', config => {
      const [rule] = config.routes!.splice(privateIndex(config), 1);
      const filesystem = config.routes!.findIndex(route => route.handle === 'filesystem');
      config.routes!.splice(filesystem + 1, 0, rule);
    }],
    ['broad terminal source', config => { privateRule(config).src = '^/.*$'; }],
    ['canonical-only source without encoded aliases', config => { privateRule(config).src = '^/triage-verdicts\\.json$'; }],
    ['successful terminal response', config => { privateRule(config).status = 200; }],
    ['cacheable private retirement', config => { privateRule(config).headers = { 'Cache-Control': 'public, max-age=3600' }; }],
    ['retirement continuing to copied files', config => { privateRule(config).continue = true; }],
    ['retirement rewritten to the app', config => { privateRule(config).dest = '/index.html'; }],
    ['extra redirect header', config => { privateRule(config).headers!.Location = '/'; }],
    ['unrelated terminal rule', config => {
      config.routes!.splice(privateIndex(config), 0, { src: '^/unreviewed-private-path$', status: 404, headers: { 'Cache-Control': 'no-store' } });
    }],
    ['ordinary header rule ending the request', config => {
      config.routes![0].status = 404;
      delete config.routes![0].continue;
    }],
  ];
  for (const [name, mutate] of rejected) {
    const config = fresh();
    mutate(config);
    assert.throws(() => check(config), undefined, name);
  }
  console.log(`PASS routing fixtures: valid configuration and ${rejected.length} rejected privacy/policy mutations`);
}
