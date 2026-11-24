import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { patchSentryDeadline } from '../build/sentry-idle-deadline';

const clientDir = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);

describe('the monitoring idle-span deadline in the production build', () => {
  afterEach(() => vi.useRealTimers());

  it('cancels a finished span deadline and enforces the same 30s deadline for an open span', async () => {
    // Bundle the actual pinned core with the production transform. An
    // in-memory transport receives any SDK envelopes from this test.
    const compiled = await build({
      stdin: { resolveDir: clientDir, contents: `
        import { Client, setCurrentClient, startIdleSpan, spanToJSON } from '@sentry/core';
        const client = new Client({
          dsn: 'https://example@localhost/1', tracesSampleRate: 1, integrations: [],
          stackParser: () => [], transport: () => ({ send: async () => ({}), flush: async () => true }),
        });
        setCurrentClient(client);
        export const openSpan = () => startIdleSpan({ name: 'test navigation', op: 'navigation' },
          { disableAutoFinish: true, finalTimeout: 30000 });
        export const stateOf = spanToJSON;
      ` },
      bundle: true, format: 'cjs', platform: 'node', write: false,
      plugins: [{
        name: 'tested-sentry-deadline',
        setup(build) {
          build.onLoad({ filter: /[/\\]@sentry[/\\]core[/\\]build[/\\]esm[/\\]tracing[/\\]idleSpan\.js$/ }, ({ path }) => ({
            contents: patchSentryDeadline(readFileSync(path, 'utf8'), path).toString(), loader: 'js',
          }));
        },
      }],
      mainFields: ['module', 'main'], conditions: ['import'],
    });
    const module = { exports: {} as {
      openSpan(): { end(): void };
      stateOf(span: unknown): { timestamp?: number; data?: Record<string,string> };
    } };
    vi.useFakeTimers();
    new Function('module', 'exports', 'require', compiled.outputFiles[0].text)(module, module.exports, require);
    const { openSpan, stateOf } = module.exports;
    const base = vi.getTimerCount();
    const ended = openSpan();
    expect(vi.getTimerCount()).toBe(base + 1);
    ended.end();
    expect(stateOf(ended).timestamp).toBeDefined();
    expect(vi.getTimerCount()).toBe(base);
    const active = openSpan();
    vi.advanceTimersByTime(29_999);
    expect(stateOf(active).timestamp).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(stateOf(active).timestamp).toBeDefined();
    expect(stateOf(active).data?.['sentry.idle_span_finish_reason']).toBe('finalTimeout');
  });
});
