import type { BrowserOptions } from '@sentry/react';
import { beforeEach, expect, it, vi } from 'vitest';

const { init, checkServedBuild } = vi.hoisted(() => ({
  init: vi.fn<(options: BrowserOptions) => void>(),
  checkServedBuild: vi.fn<() => Promise<'same' | 'newer' | 'unreachable'>>(),
}));
vi.mock('@sentry/react', () => ({ init, browserTracingIntegration: () => ({ name: 'Tracing' }), captureException: vi.fn() }));
vi.mock('../src/lib/routeRecovery', async importActual => ({
  ...await importActual<typeof import('../src/lib/routeRecovery')>(), checkServedBuild,
}));
import { start } from '../src/lib/sentry-sdk';

beforeEach(() => { init.mockClear(); checkServedBuild.mockReset(); });

it('drops a recoverable chunk report only when the server confirms a newer build', async () => {
  start('https://fixture@localhost/1', 'test');
  const options = init.mock.calls[0][0];
  const beforeSend = options.beforeSend!;
  for (const version of ['same', 'unreachable', 'newer'] as const) {
    checkServedBuild.mockResolvedValueOnce(version);
    const result = await beforeSend({ message: 'Asset error for owner@example.test', extra: { chunkLoad: true } }, {});
    if (version === 'newer') expect(result).toBeNull();
    else expect(result?.message).toBe('Asset error for [email]');
  }
  const ordinary = await beforeSend({ message: 'Profile error for user@example.test' }, {});
  expect(ordinary?.message).toBe('Profile error for [email]');
  expect(checkServedBuild).toHaveBeenCalledTimes(3);
  expect(options.sendDefaultPii).toBe(false);
  const [extension] = options.denyUrls as RegExp[];
  expect(extension.test('moz-extension://extension/file.js')).toBe(true);
  expect(extension.test('https://devshark.app/assets/route.js')).toBe(false);
});
