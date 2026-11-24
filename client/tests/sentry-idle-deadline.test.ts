import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';

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
          build.onLoad({ filter: /[/\\]@sentry[/\\]core[/\\]build[/\\]esm[/\\]tracing[/\\]idleSpan\.js$/ }, async ({ path }) => {
            const source = readFileSync(path, 'utf8');
            // Load Vite's Node-side config in Node, outside jsdom's network mocks.
            const contents = execFileSync(process.execPath, ['--input-type=module', '-e', `
              import { readFileSync } from 'node:fs';
              import { loadConfigFromFile } from 'vite';
              const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, './vite.config.ts');
              if (!loaded) throw Error('Production configuration could not be loaded');
              const plugin = (loaded.config.plugins ?? []).flat(Infinity).find(p => p?.name === 'sentry-idle-span-deadline-cleanup');
              const transform = typeof plugin?.transform === 'function' ? plugin.transform : plugin?.transform?.handler;
              const source = readFileSync(0, 'utf8');
              const result = transform ? await transform.call({}, source, process.argv[1]) : null;
              process.stdout.write(typeof result === 'string' ? result : result?.code ?? source);
            `, path], { cwd: clientDir, input: source, encoding: 'utf8' });
            return { contents, loader: 'js' };
          });
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
