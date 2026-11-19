import { afterEach, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { LOG_FLUSH_MS, useReactHarness } from '../src/coding/useReactHarness';

afterEach(() => vi.useRealTimers());

function mountHarness() {
  const hook = renderHook(() => useReactHarness());
  const frame = document.createElement('iframe');
  document.body.append(frame);
  act(() => hook.result.current.iframeRef(frame));
  const message = (data: unknown) => act(() => {
    window.dispatchEvent(new MessageEvent('message', {source: frame.contentWindow, data}));
  });
  return {...hook, frame, message};
}

it('reports a preview load failure without running code and clears it when readiness arrives', async () => {
  vi.useFakeTimers();
  const h = mountHarness();
  await act(async () => { await vi.advanceTimersByTimeAsync(20_001); });
  expect(h.result.current.ready).toBe(false);
  expect(h.result.current.loadFailed).toBe(true);
  expect(h.result.current.run).toBeNull();
  h.message({ type: 'ready' });
  expect(h.result.current.ready).toBe(true);
  expect(h.result.current.loadFailed).toBe(false);
  expect(h.result.current.run).toBeNull();
  h.unmount();
  h.frame.remove();
});

it('settles a pending run when the sandbox is restarted', async () => {
  vi.useFakeTimers();
  const h = mountHarness();
  h.message({type:'ready'});
  let run!: ReturnType<typeof h.result.current.start>;
  await act(async () => { run = h.result.current.start({}, {tests:true, preview:true}); });
  act(() => h.result.current.reload());
  let settled = false;
  void run.then(() => {settled = true;});
  await act(async () => {await vi.advanceTimersByTimeAsync(21_000);});
  expect(settled).toBe(true);
  expect((await run).status).toBe('timeout');
  h.frame.remove();
});

it('cancels readiness waits on restart and never posts an obsolete run', async () => {
  vi.useFakeTimers();
  const h = mountHarness();
  const post = vi.spyOn(h.frame.contentWindow!, 'postMessage');
  let run!: ReturnType<typeof h.result.current.start>;
  act(() => {run = h.result.current.start({}, {tests:true, preview:true});});
  act(() => h.result.current.reload());
  h.message({type:'ready'});
  await act(async () => {await vi.advanceTimersByTimeAsync(21_000);});
  expect((await run).status).toBe('timeout');
  expect(post).not.toHaveBeenCalled();
  h.frame.remove();
});

it('settles runs on unmount and ignores messages from other frames', async () => {
  vi.useFakeTimers();
  const h = mountHarness();
  h.message({type:'ready'});
  let run!: ReturnType<typeof h.result.current.start>;
  await act(async () => {run = h.result.current.start({}, {tests:true, preview:true});});
  const token = h.result.current.run!.token;
  act(() => window.dispatchEvent(new MessageEvent('message', {data:{type:'done',token,passed:1,total:1}})));
  expect(h.result.current.run?.status).toBe('running');
  h.unmount();
  let settled = false;
  void run.then(() => {settled = true;});
  await act(async () => {await vi.advanceTimersByTimeAsync(1);});
  expect(settled).toBe(true);
  h.frame.remove();
});

// Audit C3-2: the frame posts compile-error and then an empty done. The done
// replaced the error, so a build error read "0 of 0 passing".
it('keeps a build error when the frame closes the run with an empty done', async () => {
  const h = mountHarness();
  h.message({type:'ready'});
  let run!: ReturnType<typeof h.result.current.start>;
  await act(async () => {run = h.result.current.start({}, {tests:true, preview:true});});
  const token = h.result.current.run!.token;
  h.message({type:'compile-error', token, message:"Unexpected token, expected ';'"});
  h.message({type:'done', token, passed:0, failed:0, total:0});
  expect((await run).status).toBe('compile-error');
  expect(h.result.current.run).toMatchObject({status:'compile-error', compileError:"Unexpected token, expected ';'"});
  h.unmount();
  h.frame.remove();
});

// Every console line from the frame was its own state update, so a preview
// that logs in a loop or on every render redrew the whole workbench once per
// line. Lines are now drawn together, and a settled run still carries them.
it('draws console lines together and keeps them in the settled run', async () => {
  vi.useFakeTimers();
  let renders = 0;
  const hook = renderHook(() => { renders += 1; return useReactHarness(); });
  const frame = document.createElement('iframe');
  document.body.append(frame);
  act(() => hook.result.current.iframeRef(frame));
  const message = (data: unknown) => act(() => {
    window.dispatchEvent(new MessageEvent('message', {source: frame.contentWindow, data}));
  });
  message({type:'ready'});
  let run!: ReturnType<typeof hook.result.current.start>;
  await act(async () => {run = hook.result.current.start({}, {tests:false, preview:true});});
  const token = hook.result.current.run!.token;
  const before = renders;
  for (let line = 0; line < 50; line += 1) message({type:'console', token, level:'log', text:`line ${line}`});
  expect(renders - before).toBeLessThanOrEqual(1);
  await act(async () => {await vi.advanceTimersByTimeAsync(LOG_FLUSH_MS);});
  expect(hook.result.current.run?.logs).toHaveLength(50);
  expect(renders - before).toBeLessThanOrEqual(2);
  message({type:'console', token, level:'log', text:'last'});
  message({type:'done', token, passed:0, failed:0, total:0, ran:false});
  const settled = await run;
  expect(settled.logs[settled.logs.length - 1]).toEqual({level:'log', text:'last'});
  expect(hook.result.current.run?.logs).toHaveLength(51);
  hook.unmount();
  frame.remove();
});
