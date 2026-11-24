// F11-23: errors received from the real preview-frame bridge are display data.
import { afterEach, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useReactHarness } from '../src/coding/useReactHarness';
import { LOG_LINE_CUT, MAX_LOG_LINE_CHARS } from '../../shared/coding-evaluate';

const mounted: (() => void)[] = [];
afterEach(() => {
  mounted.splice(0).forEach((dispose) => dispose());
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function mountHarness() {
  const hook = renderHook(() => useReactHarness());
  const frames: HTMLIFrameElement[] = [];
  const attach = () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    frames.push(frame);
    act(() => hook.result.current.iframeRef(frame));
    return frame;
  };
  const send = (frame: HTMLIFrameElement, data: unknown) => act(() => {
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data }));
  });
  const frame = attach();
  mounted.push(() => { hook.unmount(); frames.forEach((one) => one.remove()); });
  return { ...hook, frame, attach, send };
}

async function start(h: ReturnType<typeof mountHarness>, frame = h.frame) {
  h.send(frame, { type: 'ready' });
  let completion!: ReturnType<typeof h.result.current.start>;
  await act(async () => { completion = h.result.current.start({}, { tests: true, preview: true }); });
  return { completion, token: h.result.current.run!.token };
}

const fields = ['compile-error', 'preview-error', 'test'] as const;
function receivedError(h: ReturnType<typeof mountHarness>, field: typeof fields[number]) {
  const run = h.result.current.run!;
  return field === 'compile-error' ? run.compileError : field === 'preview-error' ? run.previewError : run.cases[run.cases.length - 1]?.error;
}
function errorMessage(field: typeof fields[number], token: string, value: unknown) {
  return field === 'test'
    ? { type: field, token, name: 'failed assertion', status: 'fail', error: value, durationMs: 1 }
    : { type: field, token, message: value };
}

it.each(fields)('bounds a huge %s message after receipt and retains the run result', async (field) => {
  const h = mountHarness();
  const { token, completion } = await start(h);
  const huge = 'x'.repeat(300_000);
  h.send(h.frame, errorMessage(field, token, huge));
  expect(receivedError(h, field)).toHaveLength(MAX_LOG_LINE_CHARS + LOG_LINE_CUT.length);
  expect(receivedError(h, field)).toBe('x'.repeat(MAX_LOG_LINE_CHARS) + LOG_LINE_CUT);
  h.send(h.frame, { type: 'done', token, passed: 0, failed: 1, total: 1 });
  const settled = await completion;
  expect(settled.status).toBe(field === 'compile-error' ? 'compile-error' : 'done');
  expect(receivedError(h, field)).toHaveLength(MAX_LOG_LINE_CHARS + LOG_LINE_CUT.length);
  expect(receivedError(h, field)).toBe('x'.repeat(MAX_LOG_LINE_CHARS) + LOG_LINE_CUT);
});

it.each(fields)('coerces a structured %s message into displayable text', async (field) => {
  const h = mountHarness();
  const { token, completion } = await start(h);
  h.send(h.frame, errorMessage(field, token, { reason: 'failed assertion' }));
  expect(receivedError(h, field)).toBe('[object Object]');
  h.send(h.frame, { type: 'done', token, passed: 0, failed: 1, total: 1 });
  await completion;
});

it.each(fields)('uses the existing error fallback if a structured %s message cannot be converted', async (field) => {
  const h = mountHarness();
  const { token, completion } = await start(h);
  // A structured clone may contain a non-callable own toString property.
  // Receiving an error must not throw from the window message listener.
  h.send(h.frame, errorMessage(field, token, { toString: null }));
  expect(receivedError(h, field)).toBe(field === 'compile-error' ? 'Compile error' : field === 'preview-error' ? 'Render error' : 'Error');
  h.send(h.frame, { type: 'done', token, passed: 0, failed: 1, total: 1 });
  await completion;
});

it('preserves null and absent case errors, normal messages and compile/preview fallbacks', async () => {
  const h = mountHarness();
  const { token, completion } = await start(h);
  h.send(h.frame, errorMessage('test', token, null));
  h.send(h.frame, { type: 'test', token, name: 'no error field', status: 'pass' });
  h.send(h.frame, errorMessage('test', token, 'Expected Ready but received Waiting'));
  expect(h.result.current.run?.cases.map((one) => one.error)).toEqual([null, null, 'Expected Ready but received Waiting']);
  h.send(h.frame, errorMessage('preview-error', token, null));
  expect(h.result.current.run?.previewError).toBe('Render error');
  h.send(h.frame, errorMessage('compile-error', token, undefined));
  expect((await completion).compileError).toBe('Compile error');
});

it('keeps the useful frame diagnostic when WebKit follows it with an opaque script error', async () => {
  const h = mountHarness();
  const first = await start(h);
  const message = 'PreviewLoopTimeoutError: A loop ran for two seconds without yielding.';
  h.send(h.frame, errorMessage('preview-error', first.token, message));
  h.send(h.frame, errorMessage('preview-error', first.token, 'Script error.'));
  expect(h.result.current.run?.previewError).toBe(message);
  h.send(h.frame, errorMessage('preview-error', first.token, 'A subsequent render failed'));
  expect(h.result.current.run?.previewError).toBe('A subsequent render failed');
  h.send(h.frame, { type: 'done', token: first.token, passed: 0, failed: 1, total: 1 });
  await first.completion;
  const next = await start(h);
  h.send(h.frame, errorMessage('preview-error', next.token, 'Script error.'));
  expect(h.result.current.run?.previewError).toBe('Script error.');
  h.send(h.frame, { type: 'done', token: next.token, passed: 0, failed: 1, total: 1 });
  await next.completion;
});

it('uses the existing text boundary without splitting a surrogate pair', async () => {
  const h = mountHarness();
  const { token, completion } = await start(h);
  h.send(h.frame, errorMessage('test', token, 'x'.repeat(MAX_LOG_LINE_CHARS - 1) + '🌊' + ' tail'));
  expect(h.result.current.run?.cases[0].error).toBe('x'.repeat(MAX_LOG_LINE_CHARS - 1) + LOG_LINE_CUT);
  h.send(h.frame, { type: 'done', token, passed: 0, failed: 1, total: 1 });
  await completion;
});

it('accepts bounded errors only from the current frame and current token after a restart', async () => {
  const h = mountHarness();
  const first = await start(h);
  act(() => h.result.current.reload());
  expect((await first.completion).status).toBe('timeout');
  const replacement = h.attach();
  h.send(h.frame, { type: 'ready' });
  expect(h.result.current.ready).toBe(false);
  const next = await start(h, replacement);
  const huge = 'x'.repeat(300_000);
  h.send(h.frame, errorMessage('test', next.token, huge));
  h.send(replacement, errorMessage('test', first.token, huge));
  expect(h.result.current.run?.cases).toEqual([]);
  h.send(replacement, errorMessage('test', next.token, huge));
  expect(h.result.current.run?.cases[0].error).toHaveLength(MAX_LOG_LINE_CHARS + LOG_LINE_CUT.length);
  expect(h.result.current.run?.cases[0].error).toBe('x'.repeat(MAX_LOG_LINE_CHARS) + LOG_LINE_CUT);
  h.send(replacement, { type: 'done', token: next.token, passed: 0, failed: 1, total: 1 });
  await next.completion;
});

it('does not revive an obsolete start that waited for readiness before a restart', async () => {
  const h = mountHarness();
  const obsoletePost = vi.spyOn(h.frame.contentWindow!, 'postMessage');
  let obsolete!: ReturnType<typeof h.result.current.start>;
  act(() => { obsolete = h.result.current.start({}, { tests: true, preview: true }); });
  act(() => h.result.current.reload());
  const replacement = h.attach();
  h.send(h.frame, { type: 'ready' });
  h.send(replacement, { type: 'ready' });
  await act(async () => { expect((await obsolete).status).toBe('timeout'); });
  expect(obsoletePost).not.toHaveBeenCalled();
  expect(h.result.current.run).toBeNull();
});
