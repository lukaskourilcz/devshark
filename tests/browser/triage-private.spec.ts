import { test, expect } from './console-clean';

for (const method of ['GET', 'HEAD']) test(`${method}: the retired public triage URL is a real 404`, async ({ request }) => {
  for (const path of ['/triage-verdicts.json', '/triage-verdicts.json?cache-bust=privacy-regression']) {
    const response = await request.fetch(path, { method });
    expect(response.status()).toBe(404);
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(await response.text()).not.toContain('"verdicts"');
  }
});
