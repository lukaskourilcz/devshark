import { test, expect } from './console-clean';

for (const method of ['GET', 'HEAD']) test(`${method}: the retired public triage URL is a real 404`, async ({ request }) => {
  const filename = 'triage-verdicts.json';
  const encoded = [...filename].map(char => `%${char.charCodeAt(0).toString(16)}`).join('');
  const aliases = ['/triage-verdicts.json', '/%74riage-verdicts.json', '/triage-verdicts%2ejson', '/triage-verdicts%2Ejson', `/${encoded}`, `/${encoded.toUpperCase()}`];
  for (const path of aliases) for (const query of ['', '?cache-bust=privacy-regression']) {
    const response = await request.fetch(path + query, { method });
    expect(response.status()).toBe(404);
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(await response.text()).not.toContain('"verdicts"');
  }
});
