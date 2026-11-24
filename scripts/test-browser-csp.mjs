// Serve the same CSP, sandbox and cache headers as the deployment adapter.
// The OS selects a free loopback port; dispose the adapter on every exit.
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sink = new URL(require('../docs/quality/bundle-budget.json').measuredBuild.env.VITE_SENTRY_DSN);
if (!sink.hostname.endsWith('.localhost')) throw new Error('The measured browser DSN must use loopback');
const built = spawnSync(process.execPath, ['docker/build-handlers.mjs'], { stdio: 'inherit' });
if (built.status !== 0) process.exit(built.status ?? 1);
const server = spawn(process.execPath, ['docker/server.mjs'], {
  env: { ...process.env, PORT: '0', BIND_ADDRESS: '127.0.0.1', CSP_CONNECT_EXTRA: `https://exampleprojectref123.supabase.co ${sink.origin}` },
  stdio: ['ignore', 'pipe', 'inherit'],
});
const lines = createInterface({ input: server.stdout });
const closed = once(server, 'exit');
try {
  const [message] = await Promise.race([
    once(lines, 'line', { signal: AbortSignal.timeout(15_000) }),
    closed.then(() => { throw new Error('Docker adapter exited before becoming ready'); }),
  ]);
  const port = /^devShark listening on http:\/\/localhost:(\d+)$/.exec(message)?.[1];
  if (!port) throw new Error('Docker adapter did not report its port');
  const baseURL = `http://127.0.0.1:${port}`;
  const headers = (await fetch(baseURL, { signal: AbortSignal.timeout(5_000) })).headers;
  if (!headers.has('content-security-policy')) throw new Error('The adapter did not serve its CSP');
  const runner = spawn(process.execPath, [require.resolve('@playwright/test/cli'), 'test',
    '--project=chromium', '--workers=1', '--output=test-results/csp', 'tests/browser/csp.spec.ts'], {
    stdio: 'inherit', env: { ...process.env, TEST_BASE_URL: baseURL, PLAYWRIGHT_HTML_REPORT: 'playwright-report/csp' },
  });
  const [status] = await once(runner, 'exit');
  process.exitCode = status ?? 1;
} finally {
  lines.close();
  if (server.exitCode === null) server.kill();
  await closed;
}
