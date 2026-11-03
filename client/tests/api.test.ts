import { describe, expect, it } from 'vitest';
import { http, HttpResponse, delay } from 'msw';
import { apiFetch, friendlyError, ApiError } from '../src/lib/api';
import { server } from './mocks/server';

describe('real API transport with MSW', () => {
  it.each([401, 403])('preserves HTTP %s and asks the learner to sign in', async (status) => {
    server.use(http.get('*/api/test', () => HttpResponse.json({ error: { code: 'unauthorized' } }, { status })));
    const error = await apiFetch('/api/test').catch(e => e);
    expect(error).toBeInstanceOf(ApiError);
    if (!(error instanceof ApiError)) throw error;
    expect(error.status).toBe(status);
    expect(friendlyError(error)).toMatch(/sign in/i);
  });
  it.each([
    ['not_in_plan', 'Not in your learning plan. Choose your plan in Profile to open this topic.'],
    ['topic_locked', 'This topic is still locked. Finish the topics it builds on first.'],
    ['prerequisite_not_met', 'Pass the steps before this one first.'],
  ])('says what a signed-in learner’s Learn refusal %s means, not "sign in"', async (code, copy) => {
    server.use(http.get('*/api/test', () => HttpResponse.json({ error: { code, message: 'server wording' } }, { status: 403 })));
    const error = await apiFetch('/api/test').catch(e => e);
    expect(friendlyError(error)).toBe(copy);
  });
  it('does not expose a gateway HTML error as learner-facing copy', async () => {
    server.use(http.get('*/api/test', () => new HttpResponse('<h1>gateway</h1>', { status: 502 })));
    const error = await apiFetch('/api/test').catch(e => e);
    expect(error).toBeInstanceOf(ApiError);
    if (!(error instanceof ApiError)) throw error;
    expect(error.status).toBe(502);
    expect(friendlyError(error)).not.toContain('gateway');
  });
  it('shows the generic error for an HTML 404, not the status text', async () => {
    server.use(http.get('*/api/test', () => new HttpResponse('<h1>Not Found</h1>', { status: 404, statusText: 'Not Found', headers: { 'Content-Type': 'text/html' } })));
    const error = await apiFetch('/api/test').catch(e => e);
    expect(error).toBeInstanceOf(ApiError);
    if (!(error instanceof ApiError)) throw error;
    expect(error.status).toBe(404);
    expect(friendlyError(error)).toBe('Something went wrong. Try again.');
  });
  it('keeps the server message of a JSON 4xx', async () => {
    server.use(http.get('*/api/test', () => HttpResponse.json({ error: { code: 'not_found', message: 'No match with that code.' } }, { status: 404 })));
    const error = await apiFetch('/api/test').catch(e => e);
    expect(friendlyError(error)).toBe('No match with that code.');
  });
  it('classifies network failure separately from timeout', async () => {
    server.use(http.get('*/api/test', () => HttpResponse.error()));
    await expect(apiFetch('/api/test')).rejects.toMatchObject({ code: 'network', status: 0 });
  });
  it('aborts a slow request and permits a fresh successful retry', async () => {
    server.use(http.get('*/api/test', async () => { await delay(80); return HttpResponse.json({ ok: true }); }));
    await expect(apiFetch('/api/test', { timeoutMs: 10 })).rejects.toMatchObject({ code: 'timeout' });
    server.use(http.get('*/api/test', () => HttpResponse.json({ ok: true })));
    await expect(apiFetch('/api/test')).resolves.toEqual({ ok: true });
  });
  it('does not send an already cancelled request', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(apiFetch('/api/test', { signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' });
  });
});

describe('query retries', () => {
  it('retries a read once after a dropped connection or a server error, never after a 4xx answer', async () => {
    const { queryClient } = await import('../src/lib/queryClient');
    const retry = queryClient.getDefaultOptions().queries?.retry as (failures: number, error: unknown) => boolean;
    expect(retry(0, new ApiError('offline', 0, 'network'))).toBe(true);
    expect(retry(0, new ApiError('busy', 503, 'upstream_timeout'))).toBe(true);
    expect(retry(1, new ApiError('busy', 503, 'upstream_timeout'))).toBe(false);
    for (const status of [400, 401, 402, 403, 404, 409, 429]) {
      expect(retry(0, new ApiError('refused', status))).toBe(false);
    }
  });
});
